import path from 'node:path';
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { emptyFactTotals } from '../src/articles/article-rules';
import { ArticlesService } from '../src/articles/articles.service';
import { loadAppConfig, resolveConfigDir } from '../src/config/app-config';
import { ChecksService } from '../src/checks/checks.service';
import type { LlmConfig } from '../src/config/llm-config';
import {
  loadBasePrompt,
  loadBriefPrompt,
  loadExpandPrompt,
  resolvePromptsDir,
} from '../src/config/prompt-config';
import { GenerationLimitsService } from '../src/generation/generation-limits.service';
import { GenerationService, type GenerationEvent } from '../src/generation/generation.service';
import { MockLlmProvider } from '../src/generation/mock-provider';
import { InMemoryArticlesRepository } from './support/in-memory-articles.repository';
import { InMemoryCatalog } from './support/in-memory-catalog';
import { InMemoryFactsRepository } from './support/in-memory-facts.repository';
import { InMemoryGenerationRepository } from './support/in-memory-generation.repository';

const config = loadAppConfig(resolveConfigDir(path.resolve(process.cwd(), '../../config')));
const basePrompt = loadBasePrompt(resolvePromptsDir());
const expandPrompt = loadExpandPrompt(resolvePromptsDir());
const briefPrompt = loadBriefPrompt(resolvePromptsDir());

const LLM: LlmConfig = {
  provider: 'mock',
  baseUrl: undefined,
  apiKey: undefined,
  model: 'mock-dzen-writer',
  timeoutMs: 1_000,
  dailyLimitPerUser: 20,
  dailyBudgetUsd: 5,
  inputPricePerMtok: 0,
  outputPricePerMtok: 0,
};

const TOPIC = 'Регулирование ИИ в ЕС принято осенью 2026 года';

function setup(provider = new MockLlmProvider(), llm: LlmConfig = LLM) {
  const facts = new InMemoryFactsRepository();
  const articles = new InMemoryArticlesRepository(facts);
  const catalog = new InMemoryCatalog();
  const runs = new InMemoryGenerationRepository();
  const checks = new ChecksService(config);
  const limits = new GenerationLimitsService(runs, llm);
  const articlesService = new ArticlesService(
    articles,
    catalog,
    facts,
    checks,
    config,
    runs,
    provider,
    limits,
    briefPrompt,
  );
  const service = new GenerationService(
    runs,
    articles,
    catalog,
    provider,
    checks,
    config,
    limits,
    basePrompt,
    expandPrompt,
  );

  const addPerson = (login: string) => {
    const person = articles.addPerson(login);
    facts.people.set(person.id, person);
    return person;
  };
  const owner = addPerson('anna');
  const reviewer = addPerson('boris');
  const stranger = addPerson('vera');
  const admin = addPerson('chief');
  const actors = {
    owner: { id: owner.id, role: 'author' as const },
    reviewer: { id: reviewer.id, role: 'reviewer' as const },
    stranger: { id: stranger.id, role: 'author' as const },
    admin: { id: admin.id, role: 'admin' as const },
  };

  return { facts, articles, catalog, runs, articlesService, service, provider, actors };
}

type Harness = ReturnType<typeof setup>;

async function createReadyArticle(harness: Harness, topic = TOPIC, keywords = ['ИИ']) {
  const created = await harness.articlesService.create(harness.actors.owner, {
    topic,
    keywords,
    styleId: 'industry-news',
    format: 'news',
  });
  const article = created.article;
  const fact = harness.facts.addFact({
    type: 'news_source',
    text: 'Европейский союз принял пакет правил по ИИ.',
    sourceName: 'Reuters',
    sourceUrl: 'https://example.com/eu-ai-act',
    sourcePublishedAt: '2026-10-20',
    status: 'approved',
    createdById: harness.actors.owner.id,
  });
  await harness.articles.attachFact(article.id, fact.id, harness.actors.owner.id);
  const totals = emptyFactTotals();
  totals.news_source = { count: 1, chars: fact.text.length };
  harness.articles.setTotals(article.id, totals);
  return article;
}

async function collect(
  service: GenerationService,
  plan: Awaited<ReturnType<GenerationService['prepare']>>,
) {
  const events: GenerationEvent[] = [];
  const result = await service.run(plan, (event) => {
    events.push(event);
  });
  return { events, result };
}

// Полный корректный ответ модели по схеме с заданным текстом статьи.
function okJson(markdown: string, claimStatements: readonly string[] = []): string {
  return JSON.stringify({
    status: 'ok',
    title: 'Тема про ИИ',
    article_markdown: markdown,
    seo_title: 'Тема про ИИ',
    tags: ['ии'],
    description: 'Описание материала.',
    image_prompt: 'Спокойная иллюстрация.',
    claims: claimStatements.map((text) => ({ text, type: 'fact', fact_ids: ['F1'] })),
    questions: [],
    advertising_label_suggested: false,
    disclaimer_needed: false,
  });
}

// Новость нижняя граница 4000: 39 знаков × 120 = 4680 — внутри диапазона формата.
const LONG_MARKDOWN = 'Развернутый абзац с фактами из списка. '.repeat(120);

type StageEvent = Extract<GenerationEvent, { readonly type: 'stage' }>;

function stageEvents(events: readonly GenerationEvent[]): StageEvent[] {
  return events.filter((event): event is StageEvent => event.type === 'stage');
}

function expandStages(events: readonly GenerationEvent[]): string[] {
  return stageEvents(events)
    .filter((event) => event.stage.stage === 'expand')
    .map((event) => event.stage.status);
}

describe('запуск генерации', () => {
  it('чужой пользователь не запускает генерацию', async () => {
    const harness = setup();
    const article = await createReadyArticle(harness);

    await expect(
      harness.service.prepare(harness.actors.stranger, article.id, undefined),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('нет материала — 404', async () => {
    const harness = setup();

    await expect(
      harness.service.prepare(
        harness.actors.owner,
        '11111111-1111-4111-8111-111111111111',
        undefined,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('утверждённый материал не генерируется', async () => {
    const harness = setup();
    const article = await createReadyArticle(harness);
    harness.articles.setStatus(article.id, 'approved');

    await expect(
      harness.service.prepare(harness.actors.owner, article.id, undefined),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('без одобренных фактов запуск отклоняется со списком недостающего', async () => {
    const harness = setup();
    const created = await harness.articlesService.create(harness.actors.owner, {
      topic: TOPIC,
      keywords: ['ИИ'],
      styleId: 'industry-news',
      format: 'news',
    });

    let caught: unknown;
    try {
      await harness.service.prepare(harness.actors.owner, created.article.id, undefined);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(UnprocessableEntityException);
    expect((caught as Error).message).toContain('Не хватает одобренных фактов');
  });

  it('тема вне фокуса ИИ требует подтверждения ревьюера', async () => {
    const harness = setup();
    const article = await createReadyArticle(harness, 'Рецепт борща и его история', ['суп']);

    await expect(
      harness.service.prepare(harness.actors.owner, article.id, undefined),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    await harness.articles.insertGenerationConfirmation(article.id, harness.actors.reviewer.id);
    const plan = await harness.service.prepare(harness.actors.owner, article.id, undefined);
    expect(plan.kind).toBe('run');
  });

  it('суточный лимит останавливает запуск', async () => {
    const provider = new MockLlmProvider();
    const harness = setup(provider, { ...LLM, dailyLimitPerUser: 1 });
    const article = await createReadyArticle(harness);

    const first = await harness.service.prepare(harness.actors.owner, article.id, undefined);
    await collect(harness.service, first);

    let caught: unknown;
    try {
      await harness.service.prepare(harness.actors.owner, article.id, undefined);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(429);
  });

  it('успешный запуск создаёт версию и пишет аудит', async () => {
    const harness = setup();
    const article = await createReadyArticle(harness);

    const plan = await harness.service.prepare(harness.actors.owner, article.id, undefined);
    const { events, result } = await collect(harness.service, plan);

    expect(result.status).toBe('succeeded');
    expect(result.versionNumber).toBe(1);
    expect(harness.runs.versions).toHaveLength(1);
    expect(harness.runs.versions[0]).toMatchObject({
      articleId: article.id,
      origin: 'generated',
      styleVersion: 1,
    });
    expect(harness.runs.versions[0]?.generationRunId).toBe(result.runId);
    const stages = events.filter((event) => event.type === 'stage');
    expect([...new Set(stages.map((event) => event.stage.stage))]).toEqual([
      'prompt',
      'generate',
      'parse',
      'expand',
      'checks',
    ]);
    expect(harness.runs.audit.at(-1)).toMatchObject({ action: 'generation.succeeded' });
  });

  it('версия сохраняется с результатами проверок', async () => {
    const harness = setup();
    const article = await createReadyArticle(harness);

    const plan = await harness.service.prepare(harness.actors.owner, article.id, undefined);
    await collect(harness.service, plan);

    const version = harness.runs.versions[0];
    // Текст заглушки короткий для формата «Новость» — это предупреждение.
    expect(version?.checks.map((item) => item.id)).toContain('length_in_range');
    expect(version?.claims.length).toBeGreaterThan(0);
  });

  it('в модель идут только одобренные факты', async () => {
    const harness = setup();
    const article = await createReadyArticle(harness);
    const draft = harness.facts.addFact({
      type: 'news_source',
      text: 'Черновик факта, который не должен попасть в модель.',
      status: 'draft',
      createdById: harness.actors.owner.id,
    });
    await harness.articles.attachFact(article.id, draft.id, harness.actors.owner.id);

    const plan = await harness.service.prepare(harness.actors.owner, article.id, undefined);
    await collect(harness.service, plan);

    const prompt = harness.provider.requests[0]?.messages.at(-1)?.content ?? '';
    expect(prompt).toContain('F1 [источник новости]');
    expect(prompt).not.toContain('Черновик факта, который не должен попасть в модель.');
  });

  it('ошибка схемы даёт один повтор с текстом ошибки', async () => {
    const provider = new MockLlmProvider({
      steps: [{ kind: 'content', content: '{"status":"ok"}' }],
    });
    const harness = setup(provider);
    const article = await createReadyArticle(harness);

    const plan = await harness.service.prepare(harness.actors.owner, article.id, undefined);
    const { result } = await collect(harness.service, plan);

    // Повтор схемы и попытка доведения объёма: запросов три.
    expect(provider.requests).toHaveLength(3);
    expect(provider.requests[1]?.messages.at(-1)?.content).toContain(
      'Предыдущий ответ не прошёл проверку',
    );
    expect(result.status).toBe('succeeded');
  });

  it('две ошибки схемы — запуск failed, версия не меняется', async () => {
    const provider = new MockLlmProvider({
      steps: [
        { kind: 'content', content: 'не json вовсе' },
        { kind: 'content', content: '{"status":"ok"}' },
      ],
    });
    const harness = setup(provider);
    const article = await createReadyArticle(harness);

    const plan = await harness.service.prepare(harness.actors.owner, article.id, undefined);
    const { result } = await collect(harness.service, plan);

    expect(provider.requests).toHaveLength(2);
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('invalid_response');
    expect(harness.runs.versions).toHaveLength(0);
    expect(harness.runs.audit.at(-1)).toMatchObject({ action: 'generation.failed' });
  });

  it('needs_input сохраняет вопросы и не создаёт версию', async () => {
    const provider = new MockLlmProvider({
      steps: [
        {
          kind: 'content',
          content: JSON.stringify({
            status: 'needs_input',
            title: 'Тема',
            article_markdown: 'Текст',
            seo_title: 'Тема',
            tags: ['ии'],
            description: 'Описание',
            image_prompt: 'Обложка',
            claims: [],
            questions: ['Какой результат вы получили?'],
            advertising_label_suggested: false,
            disclaimer_needed: false,
          }),
        },
      ],
    });
    const harness = setup(provider);
    const article = await createReadyArticle(harness);

    const plan = await harness.service.prepare(harness.actors.owner, article.id, undefined);
    const { result } = await collect(harness.service, plan);

    expect(result.status).toBe('needs_input');
    expect(result.questions).toEqual(['Какой результат вы получили?']);
    expect(harness.runs.versions).toHaveLength(0);
    expect(harness.runs.runs.get(result.runId)?.questions).toEqual([
      'Какой результат вы получили?',
    ]);
  });

  it('ошибка провайдера закрывает запуск как failed', async () => {
    const provider = new MockLlmProvider({
      steps: [{ kind: 'error', code: 'unavailable' }],
    });
    const harness = setup(provider);
    const article = await createReadyArticle(harness);

    const plan = await harness.service.prepare(harness.actors.owner, article.id, undefined);
    const { result } = await collect(harness.service, plan);

    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('unavailable');
    expect(harness.runs.versions).toHaveLength(0);
  });

  it('повтор по ключу идемпотентности не создаёт второй запуск', async () => {
    const harness = setup();
    const article = await createReadyArticle(harness);

    const first = await harness.service.prepare(harness.actors.owner, article.id, 'key-1');
    await collect(harness.service, first);
    const afterFirst = harness.provider.requests.length;
    expect(afterFirst).toBeGreaterThan(0);

    const second = await harness.service.prepare(harness.actors.owner, article.id, 'key-1');

    expect(second.kind).toBe('replay');
    expect(harness.runs.runs.size).toBe(1);
    // Повтор не вызывает провайдера: число запросов не выросло.
    expect(harness.provider.requests).toHaveLength(afterFirst);
  });

  it('тот же ключ для другого материала отклоняется', async () => {
    const harness = setup();
    const article = await createReadyArticle(harness);
    const other = await createReadyArticle(harness, 'Другая тема про ИИ и агенты');

    await harness.service.prepare(harness.actors.owner, article.id, 'key-2');

    await expect(
      harness.service.prepare(harness.actors.owner, other.id, 'key-2'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('доведение объёма', () => {
  it('модель сдала короче нижней границы — второй проход разворачивает фактами', async () => {
    const provider = new MockLlmProvider({
      steps: [
        { kind: 'content', content: okJson('Короткий текст без объёма.') },
        { kind: 'content', content: okJson(LONG_MARKDOWN, ['Утверждение по факту F1']) },
      ],
    });
    const harness = setup(provider);
    const article = await createReadyArticle(harness);

    const plan = await harness.service.prepare(harness.actors.owner, article.id, undefined);
    const { events, result } = await collect(harness.service, plan);

    expect(result.status).toBe('succeeded');
    expect(provider.requests).toHaveLength(2);
    // Второй запрос — отдельный промпт доведения: в нём первая версия и целевой объём.
    const expandRequest = provider.requests[1]?.messages.at(-1)?.content ?? '';
    expect(expandRequest).toContain('Короткий текст без объёма.');
    expect(expandRequest).toContain('Целевой объём: от 4800');
    expect(expandStages(events)).toEqual(['running', 'done']);
    expect(harness.runs.versions[0]?.articleMarkdown).toBe(LONG_MARKDOWN);
    // Usage суммируется за оба прохода: токены промпта доведения не теряются.
    const done = stageEvents(events).find(
      (event) => event.stage.stage === 'expand' && event.stage.status === 'done',
    );
    expect(done?.stage.tokens).toBe(result.outputTokens);
    // Новые утверждения из второй версии попадают в версию.
    expect(harness.runs.versions[0]?.claims).toHaveLength(1);
  });

  it('две ошибки схемы в доведении — остаётся первая версия, запуск успешен', async () => {
    const provider = new MockLlmProvider({
      steps: [
        { kind: 'content', content: okJson('Короткий текст без объёма.') },
        { kind: 'content', content: 'не json' },
        { kind: 'content', content: 'тоже не json' },
      ],
    });
    const harness = setup(provider);
    const article = await createReadyArticle(harness);

    const plan = await harness.service.prepare(harness.actors.owner, article.id, undefined);
    const { events, result } = await collect(harness.service, plan);

    expect(result.status).toBe('succeeded');
    expect(result.versionNumber).toBe(1);
    expect(provider.requests).toHaveLength(3);
    expect(expandStages(events)).toEqual(['running', 'failed']);
    expect(harness.runs.versions[0]?.articleMarkdown).toBe('Короткий текст без объёма.');
  });

  it('расширение не дало объёма — остаётся первая версия', async () => {
    const provider = new MockLlmProvider({
      steps: [
        { kind: 'content', content: okJson('Краткий текст без объёма.') },
        { kind: 'content', content: okJson('Краткий текст без объёма.') },
      ],
    });
    const harness = setup(provider);
    const article = await createReadyArticle(harness);

    const plan = await harness.service.prepare(harness.actors.owner, article.id, undefined);
    const { events, result } = await collect(harness.service, plan);

    expect(result.status).toBe('succeeded');
    expect(provider.requests).toHaveLength(2);
    expect(expandStages(events)).toEqual(['running', 'failed']);
    expect(harness.runs.versions[0]?.articleMarkdown).toBe('Краткий текст без объёма.');
  });

  it('объём уже в диапазоне — доведение пропускается без второго вызова', async () => {
    const provider = new MockLlmProvider({
      steps: [{ kind: 'content', content: okJson(LONG_MARKDOWN) }],
    });
    const harness = setup(provider);
    const article = await createReadyArticle(harness);

    const plan = await harness.service.prepare(harness.actors.owner, article.id, undefined);
    const { events, result } = await collect(harness.service, plan);

    expect(result.status).toBe('succeeded');
    expect(provider.requests).toHaveLength(1);
    expect(expandStages(events)).toEqual(['skipped']);
    expect(harness.runs.versions[0]?.articleMarkdown).toBe(LONG_MARKDOWN);
  });

  it('отмена в доведении объёма закрывает запуск как отменённый', async () => {
    const provider = new MockLlmProvider({
      steps: [
        { kind: 'content', content: okJson('Короткий текст без объёма.') },
        { kind: 'error', code: 'aborted' },
      ],
    });
    const harness = setup(provider);
    const article = await createReadyArticle(harness);

    const plan = await harness.service.prepare(harness.actors.owner, article.id, undefined);
    const { events, result } = await collect(harness.service, plan);

    expect(result.status).toBe('cancelled');
    expect(provider.requests).toHaveLength(2);
    expect(expandStages(events)).toEqual(['running']);
    expect(harness.runs.statusOf(result.runId)).toBe('cancelled');
    expect(harness.runs.versions).toHaveLength(0);
  });
});

describe('оговорка ставится кодом', () => {
  it('чувствительная тема: оговорка дописана в версию, блокирующего чека нет', async () => {
    const harness = setup();
    const style = config.styles.get('industry-news');
    const disclaimer = style?.disclaimer.text ?? '';
    const article = await createReadyArticle(harness, 'Как ИИ помогает лечить пациентов', [
      'здоровье',
    ]);

    const plan = await harness.service.prepare(harness.actors.owner, article.id, undefined);
    await collect(harness.service, plan);

    const version = harness.runs.versions[0];
    // Оговорка появляется, хотя модель не сдала disclaimer_needed: ставит её код.
    expect(version?.articleMarkdown.endsWith(disclaimer)).toBe(true);
    expect(version?.articleMarkdown).toContain(`\n\n${disclaimer}`);
    expect(version?.disclaimerText).toBe(disclaimer);
    expect(version?.checks.filter((item) => item.id === 'disclaimer_required')).toEqual([]);
  });

  it('нейтральная тема: текст версии не трогается и поле пустое', async () => {
    const provider = new MockLlmProvider({
      steps: [{ kind: 'content', content: okJson(LONG_MARKDOWN) }],
    });
    const harness = setup(provider);
    const article = await createReadyArticle(harness);

    const plan = await harness.service.prepare(harness.actors.owner, article.id, undefined);
    await collect(harness.service, plan);

    const version = harness.runs.versions[0];
    expect(version?.articleMarkdown).toBe(LONG_MARKDOWN);
    expect(version?.disclaimerText).toBeNull();
  });
});

describe('отмена запуска', () => {
  it('отменённый запуск закрывается как cancelled', async () => {
    const harness = setup();
    const article = await createReadyArticle(harness);

    const plan = await harness.service.prepare(harness.actors.owner, article.id, undefined);
    const runId = plan.kind === 'run' ? plan.runId : '';
    await harness.service.cancel(harness.actors.owner, article.id, runId);

    expect(harness.runs.statusOf(runId)).toBe('cancelled');
    expect(harness.runs.versions).toHaveLength(0);
  });

  it('завершённый запуск отменить нельзя', async () => {
    const harness = setup();
    const article = await createReadyArticle(harness);

    const plan = await harness.service.prepare(harness.actors.owner, article.id, undefined);
    const { result } = await collect(harness.service, plan);

    await expect(
      harness.service.cancel(harness.actors.owner, article.id, result.runId),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('чужой пользователь не отменяет запуск', async () => {
    const harness = setup();
    const article = await createReadyArticle(harness);

    const plan = await harness.service.prepare(harness.actors.owner, article.id, undefined);
    const runId = plan.kind === 'run' ? plan.runId : '';

    await expect(
      harness.service.cancel(harness.actors.stranger, article.id, runId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
