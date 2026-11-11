import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  ArticleFormat,
  AutopilotEvent,
  AutopilotExtractInput,
  AutopilotExtractResponse,
  VersionCheck,
} from '@dzenwriter/shared';
import { z } from 'zod';
import { EDITABLE_CONTENT_STATUSES, type Actor } from '../articles/article-rules';
import type { ArticleView } from '../articles/articles.repository';
import { ARTICLES_REPOSITORY, type ArticlesRepository } from '../articles/articles.repository';
import { ArticlesService } from '../articles/articles.service';
import type { AppConfig } from '../config/app-config';
import { APP_CONFIG, FACT_EXTRACTOR_PROMPT, REFINER_PROMPT } from '../config/tokens';
import { FACTS_REPOSITORY, type FactsRepository } from '../facts/facts.repository';
import { GenerationLimitsService } from '../generation/generation-limits.service';
import {
  GENERATION_REPOSITORY,
  type GenerationRepository,
} from '../generation/generation.repository';
import {
  LLM_PROVIDER,
  LlmProviderError,
  type LlmProvider,
  type LlmUsage,
} from '../generation/llm-provider';
import { GenerationService } from '../generation/generation.service';
import { renderTemplate, sha256 } from '../generation/prompt-builder';

const MAX_ITERATIONS = 3;
const MAX_WARNINGS = 5;
const MAX_FACTS = 20;
const FACT_EXTRACTION_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['facts'],
  properties: {
    facts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'type'],
        properties: {
          text: { type: 'string' },
          type: { type: 'string', enum: ['news_source', 'company_fact'] },
          source_url: { type: 'string' },
          source_published_at: { type: 'string' },
        },
      },
    },
  },
};

const extractedFactsSchema = z.object({
  facts: z
    .array(
      z.object({
        text: z.string().trim().min(1),
        type: z.enum(['news_source', 'company_fact']),
        source_url: z.string().nullish(),
        source_published_at: z.string().nullish(),
      }),
    )
    .min(1),
});

type ExtractedFact = z.infer<typeof extractedFactsSchema>['facts'][number];

export type AutopilotEmitter = (event: AutopilotEvent) => void | Promise<void>;

@Injectable()
export class AutopilotService {
  constructor(
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    @Inject(GENERATION_REPOSITORY) private readonly runs: GenerationRepository,
    @Inject(GenerationLimitsService) private readonly limits: GenerationLimitsService,
    @Inject(ARTICLES_REPOSITORY) private readonly articles: ArticlesRepository,
    @Inject(FACTS_REPOSITORY) private readonly facts: FactsRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ArticlesService) private readonly articlesService: ArticlesService,
    @Inject(GenerationService) private readonly generations: GenerationService,
    @Inject(FACT_EXTRACTOR_PROMPT) private readonly factExtractorPrompt: string,
    @Inject(REFINER_PROMPT) private readonly refinerPrompt: string,
  ) {}

  // Извлекает факты из сырого задания, создаёт материал и черновики фактов.
  // Метки F1…Fn назначает репозиторий при привязке.
  async extractFacts(actor: Actor, input: AutopilotExtractInput): Promise<AutopilotExtractResponse> {
    await this.limits.checkLimits(actor.id);
    const startedAt = Date.now();
    const prompt = renderTemplate(this.factExtractorPrompt, { raw_task: input.rawTask });
    const promptVersion = `autopilot-extract:sha256:${sha256(prompt).slice(0, 16)}`;
    const response = await this.llm.generate({
      messages: [{ role: 'user', content: prompt }],
      jsonSchema: FACT_EXTRACTION_JSON_SCHEMA,
      temperature: 0.1,
      signal: undefined,
    });
    const facts = parseExtractedFacts(response.content);

    const hasNews = facts.some((fact) => fact.type === 'news_source');
    const style = this.pickStyle(hasNews);
    const created = await this.articlesService.create(actor, {
      topic: input.topic,
      keywords: [],
      styleId: style.id,
      format: this.pickFormat(style, hasNews),
    });
    const articleId = created.article.id;

    let factsCreated = 0;
    for (const fact of facts.slice(0, MAX_FACTS)) {
      const factId = await this.facts.withTransaction(async (tx) => {
        const id = await tx.insertFact({
          type: fact.type,
          text: fact.text,
          sourceName: null,
          sourceUrl: validSourceUrl(fact.source_url),
          sourcePublishedAt: validSourceDate(fact.source_published_at),
          productId: null,
          mentionsClient: false,
          clientPermission: false,
          supersedesId: null,
          createdBy: actor.id,
        });
        await tx.insertAudit({
          actorId: actor.id,
          action: 'fact.create',
          entityType: 'fact',
          entityId: id,
          payload: { type: fact.type, source: 'autopilot' },
        });
        return id;
      });
      await this.articles.attachFact(articleId, factId, actor.id);
      factsCreated += 1;
    }

    const runId = await this.runs.insertRun({
      articleId,
      provider: this.llm.name,
      model: this.llm.model,
      promptVersion,
      inputSnapshot: {
        kind: 'autopilot_extract',
        topic: input.topic,
        rawTaskChars: input.rawTask.length,
        factsCount: factsCreated,
        promptSha256: sha256(prompt),
      },
      idempotencyKey: null,
      createdBy: actor.id,
    });
    await this.runs.completeRun(
      runId,
      {
        status: 'succeeded',
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        latencyMs: Date.now() - startedAt,
        costUsd: this.limits.costOf(response.usage),
        errorCode: null,
        questions: [],
        finishedAt: new Date(),
      },
      null,
    );

    return { articleId, factsCreated };
  }

  // Проверки до открытия SSE: ошибки прав и незавершённых фактов — обычный HTTP-ответ.
  async prepare(actor: Actor, articleId: string): Promise<void> {
    const article = await this.requireEditableArticle(actor, articleId);
    const facts = await this.articles.listLinkedFacts(article.id);
    if (facts.length === 0) {
      throw new ConflictException('Сначала привяжите факты к материалу');
    }
    if (facts.some((fact) => fact.status !== 'approved')) {
      throw new ConflictException('Сначала одобрите все факты материала');
    }
  }

  async runAutopilot(
    actor: Actor,
    articleId: string,
    emit: AutopilotEmitter,
  ): Promise<void> {
    await this.prepare(actor, articleId);

    try {
      await emit({ type: 'stage', stage: 'brief', message: 'Собираем бриф статьи' });
      await this.articlesService.generateBrief(actor, articleId, new Date());
      await emit({ type: 'stage', stage: 'brief', message: 'Бриф готов' });

      let iteration = 1;
      await emit({
        type: 'stage',
        stage: 'generate',
        message: 'Итерация 1: генерация текста',
        iteration,
      });
      const plan = await this.generations.prepare(actor, articleId, undefined);
      const result = await this.generations.run(plan, async (event) => {
        if (event.type === 'stage' && event.stage.message !== undefined) {
          await emit({
            type: 'stage',
            stage: event.stage.stage === 'checks' ? 'checks' : 'generate',
            message: event.stage.message,
            iteration,
          });
        }
      });
      if (result.status !== 'succeeded' || result.versionNumber === null) {
        await emit({
          type: 'error',
          message:
            result.status === 'needs_input'
              ? 'Модели не хватило фактов: сначала ответьте на вопросы генерации'
              : 'Генерация текста не удалась',
        });
        return;
      }

      let versionNumber = result.versionNumber;
      let checks = await this.versionChecks(articleId, versionNumber);
      let blocking = count(checks, 'block');
      let warnings = count(checks, 'warn');
      await emit({
        type: 'stage',
        stage: 'checks',
        message: `Итерация ${iteration}: блокирующих ${blocking}, предупреждений ${warnings}`,
        iteration,
      });

      while ((blocking > 0 || warnings > MAX_WARNINGS) && iteration < MAX_ITERATIONS) {
        iteration += 1;
        await emit({
          type: 'stage',
          stage: 'refine',
          message: `Итерация ${iteration}: переписывание по замечаниям`,
          iteration,
        });
        versionNumber = await this.refine(actor, articleId, versionNumber, iteration);
        checks = await this.versionChecks(articleId, versionNumber);
        blocking = count(checks, 'block');
        warnings = count(checks, 'warn');
        await emit({
          type: 'stage',
          stage: 'checks',
          message: `Итерация ${iteration}: блокирующих ${blocking}, предупреждений ${warnings}`,
          iteration,
        });
      }

      await emit({
        type: 'result',
        versionNumber,
        iterations: iteration,
        blocking,
        warnings,
      });
    } catch (error) {
      await emit({
        type: 'error',
        message: error instanceof Error ? error.message : 'Автопилот завершился с ошибкой',
      });
    }
  }

  private async refine(
    actor: Actor,
    articleId: string,
    sourceVersionNumber: number,
    iteration: number,
  ): Promise<number> {
    const source = await this.articles.findVersion(articleId, sourceVersionNumber);
    if (!source) {
      throw new NotFoundException('Версия для переписывания не найдена');
    }
    const report = checksReport(source.checks);
    const prompt = renderTemplate(this.refinerPrompt, {
      article_markdown: source.articleMarkdown,
      checks_report: report,
    });
    const promptVersion = `autopilot-refine:sha256:${sha256(prompt).slice(0, 16)}`;
    await this.limits.checkLimits(actor.id);
    const runId = await this.runs.insertRun({
      articleId,
      provider: this.llm.name,
      model: this.llm.model,
      promptVersion,
      inputSnapshot: {
        kind: 'autopilot_refine',
        iteration,
        blocking: count(source.checks, 'block'),
        warnings: count(source.checks, 'warn'),
        promptSha256: sha256(prompt),
      },
      idempotencyKey: null,
      createdBy: actor.id,
    });

    const startedAt = Date.now();
    let usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
    let markdown: string;
    try {
      const response = await this.llm.generate({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        signal: undefined,
      });
      usage = response.usage;
      markdown = stripCodeFence(response.content);
      if (markdown.length === 0) {
        throw new LlmProviderError('invalid_response', 'Провайдер вернул пустой текст');
      }
    } catch (error) {
      const errorCode = error instanceof LlmProviderError ? error.code : 'unavailable';
      await this.runs.completeRun(
        runId,
        {
          status: errorCode === 'aborted' ? 'cancelled' : 'failed',
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          latencyMs: Date.now() - startedAt,
          costUsd: this.limits.costOf(usage),
          errorCode,
          questions: [],
          finishedAt: new Date(),
        },
        null,
      );
      throw error;
    }

    await this.runs.completeRun(
      runId,
      {
        status: 'succeeded',
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        latencyMs: Date.now() - startedAt,
        costUsd: this.limits.costOf(usage),
        errorCode: null,
        questions: [],
        finishedAt: new Date(),
      },
      null,
    );

    const article = await this.requireEditableArticle(actor, articleId);
    const saved = await this.articlesService.saveVersion(
      actor,
      articleId,
      {
        expectedVersion: article.version,
        title: source.title,
        articleMarkdown: markdown,
        seoTitle: source.seoTitle,
        tags: [...source.tags],
        description: source.description,
        imagePrompt: source.imagePrompt,
        advertisingLabel: source.advertisingLabel,
        disclaimerText: source.disclaimerText,
        claims: source.claims.map((claim) => ({
          text: claim.text,
          type: claim.type,
          factIds: claim.factIds,
        })),
      },
      new Date(),
    );
    return saved.version.number;
  }

  private async versionChecks(articleId: string, versionNumber: number): Promise<VersionCheck[]> {
    const version = await this.articles.findVersion(articleId, versionNumber);
    if (!version) {
      throw new NotFoundException('Версия автопилота не найдена');
    }
    return [...version.checks];
  }

  private async requireEditableArticle(actor: Actor, articleId: string): Promise<ArticleView> {
    const article = await this.articles.findArticle(articleId);
    if (!article) {
      throw new NotFoundException('Материал не найден');
    }
    if (actor.id !== article.ownerId && actor.role !== 'admin') {
      throw new ForbiddenException('Автопилот доступен автору материала или администратору');
    }
    if (!EDITABLE_CONTENT_STATUSES.has(article.status)) {
      throw new ConflictException(
        'Автопилот работает до утверждения: сначала верните материал в черновик',
      );
    }
    return article;
  }

  private pickStyle(
    hasNews: boolean,
  ): AppConfig['styles'] extends ReadonlyMap<string, infer T> ? T : never {
    const preferred = hasNews ? 'industry-news' : 'company-achievements';
    const style = this.config.styles.get(preferred) ?? this.config.styles.values().next().value;
    if (!style) {
      throw new UnprocessableEntityException('В конфигурации нет ни одного стиля');
    }
    return style;
  }

  private pickFormat(
    style: ReturnType<AutopilotService['pickStyle']>,
    hasNews: boolean,
  ): ArticleFormat {
    const preferred: ArticleFormat = hasNews ? 'news' : 'case';
    const fallback = style.allowed_formats[0];
    if (fallback === undefined) {
      throw new UnprocessableEntityException('У стиля нет допустимых форматов');
    }
    return style.allowed_formats.includes(preferred) ? preferred : fallback;
  }
}

function count(checks: readonly VersionCheck[], severity: VersionCheck['severity']): number {
  return checks.filter((check) => check.severity === severity).length;
}

function checksReport(checks: readonly VersionCheck[]): string {
  const relevant = checks.filter((check) => check.severity !== 'info');
  if (relevant.length === 0) {
    return 'Замечаний нет';
  }
  return relevant.map((check) => `- [${check.severity}] ${check.message}`).join('\n');
}

function parseExtractedFacts(content: string): ExtractedFact[] {
  let raw: unknown;
  try {
    raw = JSON.parse(stripCodeFence(content));
  } catch {
    throw new LlmProviderError('invalid_response', 'Провайдер вернул не JSON с фактами');
  }
  const result = extractedFactsSchema.safeParse(raw);
  if (!result.success) {
    throw new LlmProviderError('invalid_response', 'Провайдер вернул факты не по схеме');
  }
  return result.data.facts;
}

function stripCodeFence(value: string): string {
  let text = value.trim();
  if (text.startsWith('```')) {
    text = text.slice(3);
    const lineEnd = text.indexOf('\n');
    if (lineEnd >= 0 && /^[A-Za-z0-9_-]*\s*$/.test(text.slice(0, lineEnd))) {
      text = text.slice(lineEnd + 1);
    }
  }
  if (text.endsWith('```')) {
    text = text.slice(0, -3);
  }
  return text.trim();
}

function validSourceUrl(value: string | null | undefined): string | null {
  return value !== null && value !== undefined && /^https?:\/\/\S+$/.test(value) ? value : null;
}

function validSourceDate(value: string | null | undefined): string | null {
  return value !== null && value !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}
