import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  generationOutputSchema,
  type ArticleFormat,
  type FormatConfig,
  type GenerationOutput,
  type GenerationResult,
  type GenerationStageEvent,
  type GenerationStatus,
  type StyleConfig,
} from '@dzenwriter/shared';
import {
  ARTICLES_REPOSITORY,
  type ArticlesRepository,
  type ArticleView,
} from '../articles/articles.repository';
import { EDITABLE_CONTENT_STATUSES, isInAiFocus } from '../articles/article-rules';
import { CATALOG_REPOSITORY, type CatalogRepository } from '../catalog/catalog.repository';
import type { CheckFact } from '../checks/check-context';
import { ChecksService } from '../checks/checks.service';
import type { AppConfig } from '../config/app-config';
import { describeIssues } from '../config/errors';
import type { LlmConfig } from '../config/llm-config';
import { APP_CONFIG, BASE_PROMPT, LLM_CONFIG } from '../config/tokens';
import { moscowDayStart, todayInMoscow } from '../common/moscow-time';
import {
  GENERATION_REPOSITORY,
  type GenerationInputSnapshot,
  type GenerationRepository,
  type GenerationRunRecord,
  type NewVersion,
} from './generation.repository';
import {
  LLM_PROVIDER,
  LlmProviderError,
  type LlmMessage,
  type LlmProvider,
  type LlmUsage,
} from './llm-provider';
import { GENERATION_OUTPUT_JSON_SCHEMA } from './output-schema';
import { buildPrompt, type BuiltPrompt, type PromptFact } from './prompt-builder';

const TEMPERATURE = 0.7;
const RUNS_SHOWN = 20;
const SYSTEM_PROMPT =
  'Ты — Dzen Writer. Отвечай строго одним JSON-объектом по схеме ответа: без пояснений, без markdown-обёртки и без текста вокруг.';

export type GenerationEvent =
  | { readonly type: 'stage'; readonly stage: GenerationStageEvent }
  | { readonly type: 'result'; readonly result: GenerationResult };

export type GenerationEmitter = (event: GenerationEvent) => void | Promise<void>;

export interface GenerationContext {
  readonly actorId: string;
  readonly article: ArticleView;
  readonly style: StyleConfig;
  readonly format: FormatConfig;
  readonly formatId: ArticleFormat;
  readonly productName: string | null;
  // В модель идут только одобренные факты: черновики и отклонённые остаются в библиотеке.
  readonly facts: readonly PromptFact[];
  // Все привязанные факты со статусом: их проверяет движок проверок.
  readonly checkFacts: readonly CheckFact[];
  // Метки фактов, которые получила модель: на них ссылаются утверждения.
  readonly factLabels: readonly string[];
  // Метки фактов, которые остались в материале, но в модель не попали.
  readonly skippedFactLabels: readonly string[];
  readonly today: string;
}

export type GenerationPlan =
  | { readonly kind: 'replay'; readonly run: GenerationRunRecord }
  | {
      readonly kind: 'run';
      readonly runId: string;
      readonly context: GenerationContext;
      readonly prompt: BuiltPrompt;
      readonly snapshot: GenerationInputSnapshot;
    };

interface ActiveRun {
  readonly controller: AbortController;
  readonly finished: Promise<void>;
  resolveFinished: () => void;
}

@Injectable()
export class GenerationService {
  private readonly active = new Map<string, ActiveRun>();

  constructor(
    @Inject(GENERATION_REPOSITORY) private readonly repository: GenerationRepository,
    @Inject(ARTICLES_REPOSITORY) private readonly articles: ArticlesRepository,
    @Inject(CATALOG_REPOSITORY) private readonly catalog: CatalogRepository,
    @Inject(LLM_PROVIDER) private readonly provider: LlmProvider,
    @Inject(ChecksService) private readonly checks: ChecksService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(LLM_CONFIG) private readonly llm: LlmConfig,
    @Inject(BASE_PROMPT) private readonly basePrompt: string,
  ) {}

  // Фаза до потока: все проверки, которые должны ответить обычной ошибкой, а не событием SSE.
  async prepare(
    actor: { readonly id: string; readonly role: string },
    articleId: string,
    idempotencyKey: string | undefined,
  ): Promise<GenerationPlan> {
    const article = await this.articles.findArticle(articleId);
    if (!article) {
      throw new NotFoundException('Материал не найден');
    }
    if (actor.id !== article.ownerId && actor.role !== 'admin') {
      throw new ForbiddenException('Запустить генерацию может автор материала или администратор');
    }
    if (!EDITABLE_CONTENT_STATUSES.has(article.status)) {
      throw new ConflictException(
        'Генерация доступна до утверждения: сначала верните материал в черновик',
      );
    }
    const style = this.config.styles.get(article.styleId);
    if (!style) {
      throw new UnprocessableEntityException('Стиль материала не найден в конфигурации');
    }

    if (idempotencyKey !== undefined) {
      const existing = await this.repository.findRunByIdempotencyKey(idempotencyKey);
      if (existing !== undefined) {
        if (existing.articleId !== articleId || existing.createdBy !== actor.id) {
          throw new ConflictException('Ключ идемпотентности уже использован для другого запуска');
        }
        return { kind: 'replay', run: existing };
      }
    }

    await this.checkLimits(actor.id);

    const context = await this.buildContext(actor.id, article, style);
    const prompt = buildPrompt({
      basePrompt: this.basePrompt,
      style,
      format: context.format,
      formatId: context.formatId,
      topic: article.topic,
      keywords: article.keywords,
      tone: article.tone,
      lengthMin: article.lengthMin,
      lengthMax: article.lengthMax,
      productName: context.productName,
      facts: context.facts,
      today: context.today,
    });
    const snapshot: GenerationInputSnapshot = {
      topic: article.topic,
      styleId: style.id,
      styleVersion: style.version,
      format: article.format,
      tone: article.tone,
      lengthMin: article.lengthMin,
      lengthMax: article.lengthMax,
      productId: article.productId,
      factIds: context.facts.map((fact) => fact.factId),
      factLabels: context.facts.map((fact) => fact.label),
      promptSha256: prompt.sha256,
    };

    const runId = await this.repository.insertRun({
      articleId: article.id,
      provider: this.provider.name,
      model: this.provider.model,
      promptVersion: prompt.promptVersion,
      inputSnapshot: snapshot,
      idempotencyKey: idempotencyKey ?? null,
      createdBy: actor.id,
    });
    await this.repository.insertAudit({
      actorId: actor.id,
      action: 'generation.start',
      entityType: 'article',
      entityId: article.id,
      payload: {
        runId,
        provider: this.provider.name,
        model: this.provider.model,
        promptVersion: prompt.promptVersion,
        factCount: context.facts.length,
      },
    });

    return { kind: 'run', runId, context, prompt, snapshot };
  }

  // Фаза потока: стадии и итог. Возвращает результат, который уходит последним событием.
  async run(plan: GenerationPlan, emit: GenerationEmitter): Promise<GenerationResult> {
    if (plan.kind === 'replay') {
      const result = toResult(plan.run);
      await emit({ type: 'result', result });
      return result;
    }

    const controller = new AbortController();
    let resolveFinished: () => void = () => {};
    const finished = new Promise<void>((resolve) => {
      resolveFinished = resolve;
    });
    this.active.set(plan.runId, { controller, finished, resolveFinished });

    const startedAt = Date.now();
    let usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
    try {
      await emit({
        type: 'stage',
        stage: {
          stage: 'prompt',
          status: 'done',
          message: `Промпт собран: ${plan.context.facts.length} факт(ов), версия ${plan.prompt.promptVersion}`,
        },
      });
      await emit({ type: 'stage', stage: { stage: 'generate', status: 'running' } });

      const messages = this.buildMessages(plan.prompt.text);
      let output: GenerationOutput | undefined;
      let schemaError = '';

      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const request = attempt === 1 ? messages : this.retryMessages(messages, schemaError);
        let response;
        try {
          response = await this.provider.generate({
            messages: request,
            jsonSchema: GENERATION_OUTPUT_JSON_SCHEMA,
            temperature: TEMPERATURE,
            signal: controller.signal,
          });
        } catch (error) {
          return await this.failRun(plan, emit, error, usage, startedAt);
        }
        usage = {
          inputTokens: usage.inputTokens + response.usage.inputTokens,
          outputTokens: usage.outputTokens + response.usage.outputTokens,
        };
        await emit({
          type: 'stage',
          stage: {
            stage: 'generate',
            status: 'done',
            message: `Токены: ${usage.inputTokens} входных, ${usage.outputTokens} выходных`,
            tokens: usage.outputTokens,
          },
        });

        await emit({ type: 'stage', stage: { stage: 'parse', status: 'running' } });
        const parsed = parseModelOutput(response.content);
        if (parsed.ok) {
          output = parsed.output;
          await emit({
            type: 'stage',
            stage: { stage: 'parse', status: 'done', message: 'Ответ соответствует схеме' },
          });
          break;
        }
        schemaError = parsed.error;
        await emit({
          type: 'stage',
          stage: {
            stage: 'parse',
            status: 'failed',
            message:
              attempt < 2 ? 'Схема не сошлась, повторяем с текстом ошибки' : 'Схема не сошлась',
          },
        });
      }

      if (output === undefined) {
        return await this.finishFailed(plan, emit, 'invalid_response', usage, startedAt);
      }

      if (output.status === 'needs_input') {
        const result = await this.finishNeedsInput(plan, emit, output.questions, usage, startedAt);
        return result;
      }

      // Проверки считаются до сохранения версии: блокирующие результаты
      // должны быть в версии, а не в ответе.
      await emit({ type: 'stage', stage: { stage: 'checks', status: 'running' } });
      const checks = this.checks.run({
        style: plan.context.style,
        format: plan.context.format,
        topic: plan.context.article.topic,
        keywords: plan.context.article.keywords,
        productName: plan.context.productName,
        facts: plan.context.checkFacts,
        title: output.title,
        seoTitle: output.seo_title,
        tags: output.tags,
        articleMarkdown: output.article_markdown,
        advertisingLabel: output.advertising_label_suggested,
        disclaimerText: output.disclaimer_needed ? plan.context.style.disclaimer.text : null,
        claims: output.claims.map((claim) => ({
          text: claim.text,
          type: claim.type,
          factIds: claim.fact_ids,
        })),
        factLabels: plan.context.factLabels,
      });
      const blocking = checks.checks.filter((item) => item.severity === 'block').length;
      await emit({
        type: 'stage',
        stage: {
          stage: 'checks',
          status: 'done',
          message:
            blocking === 0
              ? 'Блокирующих проверок нет'
              : `Блокирующих проверок: ${blocking}. Материал не пройдёт на ревью, пока их не снимут`,
        },
      });

      const version: NewVersion = {
        articleId: plan.context.article.id,
        origin: 'generated',
        title: output.title,
        articleMarkdown: output.article_markdown,
        seoTitle: output.seo_title,
        tags: output.tags,
        description: output.description,
        imagePrompt: output.image_prompt,
        advertisingLabel: output.advertising_label_suggested,
        disclaimerText: output.disclaimer_needed ? plan.context.style.disclaimer.text : null,
        claims: checks.claims,
        checks: checks.checks,
        styleVersion: plan.context.style.version,
        promptVersion: plan.prompt.promptVersion,
        generationRunId: plan.runId,
        createdBy: plan.context.actorId,
      };

      const costUsd = this.costOf(usage);
      const versionNumber = await this.repository.completeRun(
        plan.runId,
        {
          status: 'succeeded',
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          latencyMs: Date.now() - startedAt,
          costUsd,
          errorCode: null,
          questions: [],
          finishedAt: new Date(),
        },
        version,
      );
      await this.repository.insertAudit({
        actorId: plan.context.actorId,
        action: 'generation.succeeded',
        entityType: 'article',
        entityId: plan.context.article.id,
        payload: {
          runId: plan.runId,
          versionNumber,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          latencyMs: Date.now() - startedAt,
          costUsd,
        },
      });

      const result: GenerationResult = {
        runId: plan.runId,
        status: 'succeeded',
        versionNumber,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        latencyMs: Date.now() - startedAt,
        questions: [],
        errorCode: null,
      };
      await emit({ type: 'result', result });
      return result;
    } catch {
      // Непредвиденная ошибка не должна оставлять запуск «висящим» в базе.
      return await this.finishFailed(plan, emit, 'unavailable', usage, startedAt);
    } finally {
      this.active.delete(plan.runId);
      resolveFinished();
    }
  }

  async listRuns(articleId: string): Promise<GenerationRunRecord[]> {
    const article = await this.articles.findArticle(articleId);
    if (!article) {
      throw new NotFoundException('Материал не найден');
    }
    return this.repository.listRuns(articleId, RUNS_SHOWN);
  }

  // Отмена запуска: провайдер получает сигнал, а запуск закрывается со статусом cancelled.
  async cancel(
    actor: { readonly id: string; readonly role: string },
    articleId: string,
    runId: string,
  ): Promise<GenerationRunRecord> {
    const run = await this.repository.findRun(runId);
    if (!run || run.articleId !== articleId) {
      throw new NotFoundException('Запуск не найден');
    }
    if (actor.id !== run.createdBy && actor.role !== 'admin') {
      throw new ForbiddenException('Отменить запуск может его автор или администратор');
    }
    if (run.status !== 'running') {
      throw new ConflictException('Запуск уже завершён');
    }

    const active = this.active.get(runId);
    if (active !== undefined) {
      active.controller.abort();
      await active.finished;
    } else {
      // Процесса запуска в памяти нет: закрываем запуск в базе, чтобы он не остался «висящим».
      await this.repository.completeRun(
        runId,
        {
          status: 'cancelled',
          inputTokens: null,
          outputTokens: null,
          latencyMs: null,
          costUsd: null,
          errorCode: null,
          questions: [],
          finishedAt: new Date(),
        },
        null,
      );
    }

    const updated = await this.repository.findRun(runId);
    if (!updated) {
      throw new NotFoundException('Запуск не найден');
    }
    await this.repository.insertAudit({
      actorId: actor.id,
      action: 'generation.cancelled',
      entityType: 'article',
      entityId: articleId,
      payload: { runId },
    });
    return updated;
  }

  // Условия запуска: факты, продукт и объём заметок должны быть как у перехода в черновик.
  private async buildContext(
    actorId: string,
    article: ArticleView,
    style: StyleConfig,
  ): Promise<GenerationContext> {
    const format = this.config.formats.formats[article.format];
    const productName =
      article.productId === null
        ? null
        : ((await this.catalog.findProduct(article.productId))?.name ?? null);

    const linked = await this.articles.listLinkedFacts(article.id);
    const facts: PromptFact[] = [];
    const checkFacts: CheckFact[] = [];
    const factLabels: string[] = [];
    const skippedFactLabels: string[] = [];
    for (const link of linked) {
      checkFacts.push({
        label: link.label,
        id: link.factId,
        type: link.type,
        status: link.status,
        text: link.text,
        sourceName: link.sourceName,
        sourceUrl: link.sourceUrl,
        sourcePublishedAt: link.sourcePublishedAt,
        mentionsClient: false,
        clientPermission: false,
      });
      if (link.status === 'approved') {
        facts.push({
          factId: link.factId,
          label: link.label,
          type: link.type,
          text: link.text,
          sourceName: link.sourceName,
          sourceUrl: link.sourceUrl,
          sourcePublishedAt: link.sourcePublishedAt,
        });
        factLabels.push(link.label);
      } else {
        skippedFactLabels.push(link.label);
      }
    }

    const totals = await this.articles.approvedFactTotals(article.id);
    const missing = missingRequirements(style, totals, article.productId);
    if (missing.length > 0) {
      throw new UnprocessableEntityException(missing.join('; '));
    }

    if (!isInAiFocus(article.topic, article.keywords)) {
      const confirmation = await this.articles.findGenerationConfirmation(article.id);
      if (!confirmation) {
        throw new UnprocessableEntityException(
          'Тема вне фокуса ИИ: запуск требует подтверждения ревьюера',
        );
      }
    }

    return {
      actorId,
      article,
      style,
      format,
      formatId: article.format,
      productName,
      facts,
      checkFacts,
      factLabels,
      skippedFactLabels,
      today: todayInMoscow(new Date()),
    };
  }

  // Суточные лимиты: запуск на пользователя и общий бюджет. 0 — лимита нет.
  private async checkLimits(actorId: string): Promise<void> {
    const since = moscowDayStart(new Date());
    const used = await this.repository.countRunsSince(actorId, since);
    if (this.llm.dailyLimitPerUser > 0 && used >= this.llm.dailyLimitPerUser) {
      throw new HttpException(
        `Дневной лимит генераций исчерпан: ${used} из ${this.llm.dailyLimitPerUser}. Попробуйте завтра.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const spent = Number(await this.repository.sumCostSince(since));
    if (this.llm.dailyBudgetUsd > 0 && spent >= this.llm.dailyBudgetUsd) {
      throw new HttpException(
        `Дневной бюджет генерации исчерпан: ${spent.toFixed(2)} из ${this.llm.dailyBudgetUsd} $. Попробуйте завтра.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private buildMessages(promptText: string): LlmMessage[] {
    return [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: promptText },
    ];
  }

  // Повтор после ошибки схемы: модели уходит текст ошибки, чтобы она исправила ответ.
  private retryMessages(messages: readonly LlmMessage[], schemaError: string): LlmMessage[] {
    const last = messages[messages.length - 1];
    const base = last?.content ?? '';
    return [
      ...messages.slice(0, -1),
      {
        role: 'user',
        content: `${base}\n\nПредыдущий ответ не прошёл проверку:\n${schemaError}\n\nИсправь ответ и верни только JSON по схеме.`,
      },
    ];
  }

  private async failRun(
    plan: GenerationPlan & { kind: 'run' },
    emit: GenerationEmitter,
    error: unknown,
    usage: LlmUsage,
    startedAt: number,
  ): Promise<GenerationResult> {
    if (error instanceof LlmProviderError && error.code === 'aborted') {
      return await this.finishCancelled(plan, emit, usage, startedAt);
    }
    const code = error instanceof LlmProviderError ? error.code : 'unavailable';
    await emit({
      type: 'stage',
      stage: { stage: 'generate', status: 'failed', message: providerMessage(code) },
    });
    return await this.finishFailed(plan, emit, code, usage, startedAt);
  }

  private async finishFailed(
    plan: GenerationPlan & { kind: 'run' },
    emit: GenerationEmitter,
    errorCode: string,
    usage: LlmUsage,
    startedAt: number,
  ): Promise<GenerationResult> {
    const latencyMs = Date.now() - startedAt;
    await this.repository.completeRun(
      plan.runId,
      {
        status: 'failed',
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        latencyMs,
        costUsd: this.costOf(usage),
        errorCode,
        questions: [],
        finishedAt: new Date(),
      },
      null,
    );
    await this.repository.insertAudit({
      actorId: plan.context.actorId,
      action: 'generation.failed',
      entityType: 'article',
      entityId: plan.context.article.id,
      payload: { runId: plan.runId, errorCode },
    });
    const result: GenerationResult = {
      runId: plan.runId,
      status: 'failed',
      versionNumber: null,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      latencyMs,
      questions: [],
      errorCode,
    };
    await emit({ type: 'result', result });
    return result;
  }

  private async finishNeedsInput(
    plan: GenerationPlan & { kind: 'run' },
    emit: GenerationEmitter,
    questions: readonly string[],
    usage: LlmUsage,
    startedAt: number,
  ): Promise<GenerationResult> {
    const latencyMs = Date.now() - startedAt;
    await this.repository.completeRun(
      plan.runId,
      {
        status: 'needs_input',
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        latencyMs,
        costUsd: this.costOf(usage),
        errorCode: null,
        questions: [...questions],
        finishedAt: new Date(),
      },
      null,
    );
    await this.repository.insertAudit({
      actorId: plan.context.actorId,
      action: 'generation.needs_input',
      entityType: 'article',
      entityId: plan.context.article.id,
      payload: { runId: plan.runId, questionCount: questions.length },
    });
    const result: GenerationResult = {
      runId: plan.runId,
      status: 'needs_input',
      versionNumber: null,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      latencyMs,
      questions: [...questions],
      errorCode: null,
    };
    await emit({ type: 'result', result });
    return result;
  }

  private async finishCancelled(
    plan: GenerationPlan & { kind: 'run' },
    emit: GenerationEmitter,
    usage: LlmUsage,
    startedAt: number,
  ): Promise<GenerationResult> {
    const latencyMs = Date.now() - startedAt;
    await this.repository.completeRun(
      plan.runId,
      {
        status: 'cancelled',
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        latencyMs,
        costUsd: this.costOf(usage),
        errorCode: null,
        questions: [],
        finishedAt: new Date(),
      },
      null,
    );
    await this.repository.insertAudit({
      actorId: plan.context.actorId,
      action: 'generation.cancelled',
      entityType: 'article',
      entityId: plan.context.article.id,
      payload: { runId: plan.runId },
    });
    const result: GenerationResult = {
      runId: plan.runId,
      status: 'cancelled',
      versionNumber: null,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      latencyMs,
      questions: [],
      errorCode: null,
    };
    await emit({ type: 'result', result });
    return result;
  }

  // Стоимость считается по ценам провайдера из окружения.
  private costOf(usage: LlmUsage): number {
    const input = (usage.inputTokens / 1_000_000) * this.llm.inputPricePerMtok;
    const output = (usage.outputTokens / 1_000_000) * this.llm.outputPricePerMtok;
    return Math.round((input + output) * 10_000) / 10_000;
  }
}

// Разбор ответа модели: JSON и схема. Ошибка схемы уходит в повтор.
export function parseModelOutput(
  content: string,
):
  | { readonly ok: true; readonly output: GenerationOutput }
  | { readonly ok: false; readonly error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `ответ не разобрался как JSON: ${reason}` };
  }
  const result = generationOutputSchema.safeParse(raw);
  if (!result.success) {
    return { ok: false, error: describeIssues(result.error.issues).join('; ') };
  }
  return { ok: true, output: result.data };
}

// Чего не хватает стилю для запуска: тот же список, что и для перехода в черновик.
function missingRequirements(
  style: StyleConfig,
  totals: { readonly [type: string]: { readonly count: number; readonly chars: number } },
  productId: string | null,
): string[] {
  const problems: string[] = [];
  const approved = style.inputs.required_fact_types.reduce(
    (sum, type) => sum + (totals[type]?.count ?? 0),
    0,
  );
  if (approved < style.inputs.min_facts) {
    problems.push(`Не хватает одобренных фактов: ${approved} из ${style.inputs.min_facts}`);
  }
  if (style.inputs.requires_product === true && productId === null) {
    problems.push('Для стиля выберите продукт');
  }
  if (style.inputs.min_note_chars !== undefined) {
    const chars = totals.experience_note?.chars ?? 0;
    if (chars < style.inputs.min_note_chars) {
      problems.push(
        `Не хватает знаков в заметках опыта: ${chars} из ${style.inputs.min_note_chars}`,
      );
    }
  }
  return problems;
}

function providerMessage(code: string): string {
  switch (code) {
    case 'timeout':
      return 'Провайдер не ответил вовремя';
    case 'auth':
      return 'Провайдер отклонил ключ';
    case 'invalid_response':
      return 'Провайдер вернул неожиданный ответ';
    default:
      return 'Провайдер недоступен';
  }
}

export function toResult(run: GenerationRunRecord): GenerationResult {
  return {
    runId: run.id,
    status: run.status as GenerationStatus,
    versionNumber: run.versionNumber,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    latencyMs: run.latencyMs,
    questions: [...run.questions],
    errorCode: run.errorCode,
  };
}
