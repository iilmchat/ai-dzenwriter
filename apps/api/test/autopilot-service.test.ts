import path from 'node:path';
import { UnprocessableEntityException } from '@nestjs/common';
import type { VersionCheck } from '@dzenwriter/shared';
import { describe, expect, it, vi } from 'vitest';
import { AutopilotService, INVALID_FACTS_FORMAT_MESSAGE } from '../src/autopilot/autopilot.service';
import { ArticlesService } from '../src/articles/articles.service';
import { ChecksService } from '../src/checks/checks.service';
import { loadAppConfig, resolveConfigDir } from '../src/config/app-config';
import {
  loadBasePrompt,
  loadBriefPrompt,
  loadExpandPrompt,
  loadFactExtractorPrompt,
  loadFragmentPrompt,
  loadRefinerPrompt,
  loadTitlesPrompt,
  resolvePromptsDir,
} from '../src/config/prompt-config';
import type { LlmConfig } from '../src/config/llm-config';
import { GenerationLimitsService } from '../src/generation/generation-limits.service';
import { GenerationService } from '../src/generation/generation.service';
import { MockLlmProvider } from '../src/generation/mock-provider';
import { InMemoryArticlesRepository } from './support/in-memory-articles.repository';
import { InMemoryCatalog } from './support/in-memory-catalog';
import { InMemoryFactsRepository } from './support/in-memory-facts.repository';
import { InMemoryGenerationRepository } from './support/in-memory-generation.repository';
import { InMemoryNotificationsRepository } from './support/in-memory-notifications.repository';
import { NotificationsService } from '../src/notifications/notifications.service';

const config = loadAppConfig(resolveConfigDir(path.resolve(process.cwd(), '../../config')));
const promptsDir = resolvePromptsDir();
const extractorPrompt = loadFactExtractorPrompt(promptsDir);
const refinerPrompt = loadRefinerPrompt(promptsDir);

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

const RAW_TASK =
  'Компания «Ромашка» объявила о запуске платформы для автоматизации отчётности. ' +
  'Платформа доступна с 1 ноября 2026 года, пишет издание «Ведомости».';

function setup(provider = new MockLlmProvider()) {
  const facts = new InMemoryFactsRepository();
  const articles = new InMemoryArticlesRepository(facts);
  const catalog = new InMemoryCatalog();
  const runs = new InMemoryGenerationRepository();
  const checks = new ChecksService(config);
  const limits = new GenerationLimitsService(runs, LLM);
  const notifications = new NotificationsService(new InMemoryNotificationsRepository());
  const articlesService = new ArticlesService(
    articles,
    catalog,
    facts,
    checks,
    config,
    runs,
    provider,
    limits,
    loadBriefPrompt(promptsDir),
    loadFragmentPrompt(promptsDir),
    loadTitlesPrompt(promptsDir),
    notifications,
  );
  const generations = new GenerationService(
    runs,
    articles,
    catalog,
    provider,
    checks,
    config,
    limits,
    loadBasePrompt(promptsDir),
    loadExpandPrompt(promptsDir),
    notifications,
  );
  const service = new AutopilotService(
    provider,
    runs,
    limits,
    articles,
    facts,
    config,
    articlesService,
    generations,
    extractorPrompt,
    refinerPrompt,
  );

  const owner = articles.addPerson('anna');
  facts.people.set(owner.id, owner);

  return {
    service,
    articles,
    facts,
    runs,
    provider,
    owner: { id: owner.id, role: 'author' as const },
  };
}

describe('автопилот: извлечение фактов', () => {
  it('создаёт материал и черновики фактов по ответу модели', async () => {
    const provider = new MockLlmProvider({
      steps: [
        {
          kind: 'content',
          content: JSON.stringify({
            facts: [
              {
                text: 'Платформа запущена 1 ноября 2026 года.',
                type: 'news_source',
                source_url: 'https://example.com/news',
                source_published_at: '2026-10-30',
              },
              { text: 'Компания «Ромашка» выпустила платформу.', type: 'company_fact' },
            ],
          }),
        },
      ],
    });
    const harness = setup(provider);

    const result = await harness.service.extractFacts(harness.owner, {
      rawTask: RAW_TASK,
      topic: 'Запуск платформы «Ромашка»',
    });

    expect(result.factsCreated).toBe(2);
    const article = await harness.articles.findArticle(result.articleId);
    expect(article?.status).toBe('idea');
    expect(article?.styleId).toBe('industry-news');
    expect(article?.format).toBe('news');

    const linked = await harness.articles.listLinkedFacts(result.articleId);
    expect(linked.map((fact) => fact.status)).toEqual(['draft', 'draft']);
    expect(linked.map((fact) => fact.label)).toEqual(['F1', 'F2']);
    expect(linked[0]?.sourceUrl).toBe('https://example.com/news');

    // Расход LLM учтён в истории запусков, иначе лимит обходится через автопилот.
    const usageRuns = await harness.runs.listRuns(result.articleId, 10);
    expect(usageRuns).toHaveLength(1);
    expect(usageRuns[0]?.promptVersion.startsWith('autopilot-extract:')).toBe(true);
  });

  it('извлекает факты из ответа в markdown-обёртке с текстом вокруг', async () => {
    const provider = new MockLlmProvider({
      steps: [
        {
          kind: 'content',
          content: [
            'Вот факты, которые удалось извлечь:',
            '```json',
            JSON.stringify({
              facts: [
                {
                  text: 'Платформа запущена 1 ноября 2026 года.',
                  type: 'news_source',
                  source_url: 'https://example.com/news',
                  source_published_at: '2026-10-30',
                },
                { text: 'Компания «Ромашка» выпустила платформу.', type: 'company_fact' },
              ],
            }),
            '```',
            'Готово.',
          ].join('\n'),
        },
      ],
    });
    const harness = setup(provider);

    const result = await harness.service.extractFacts(harness.owner, {
      rawTask: RAW_TASK,
      topic: 'Запуск платформы «Ромашка»',
    });

    expect(result.factsCreated).toBe(2);
    expect(provider.requests).toHaveLength(1);
    const linked = await harness.articles.listLinkedFacts(result.articleId);
    expect(linked[0]?.sourceUrl).toBe('https://example.com/news');
  });

  it('повторяет запрос один раз и принимает исправленный ответ', async () => {
    const provider = new MockLlmProvider({
      steps: [
        { kind: 'content', content: 'Я не могу извлечь факты из этого задания.' },
        {
          kind: 'content',
          content: JSON.stringify({
            facts: [{ text: 'Компания выпустила платформу.', type: 'company_fact' }],
          }),
        },
      ],
    });
    const harness = setup(provider);

    const result = await harness.service.extractFacts(harness.owner, {
      rawTask: RAW_TASK,
      topic: 'Запуск платформы «Ромашка»',
    });

    expect(result.factsCreated).toBe(1);
    expect(provider.requests).toHaveLength(2);
  });

  it('возвращает 422, если модель дважды ответила текстом вместо JSON', async () => {
    const provider = new MockLlmProvider({
      steps: [
        { kind: 'content', content: 'Я не могу извлечь факты из этого задания.' },
        { kind: 'content', content: 'Я не могу извлечь факты из этого задания.' },
      ],
    });
    const harness = setup(provider);

    const error: unknown = await harness.service
      .extractFacts(harness.owner, {
        rawTask: RAW_TASK,
        topic: 'Запуск платформы «Ромашка»',
      })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as Error).message).toBe(INVALID_FACTS_FORMAT_MESSAGE);
    expect(provider.requests).toHaveLength(2);
  });
});

const BLOCKING: VersionCheck = {
  id: 'numbers',
  severity: 'block',
  message: 'Число не подтверждено фактом',
};
const WARNING: VersionCheck = {
  id: 'superlative',
  severity: 'warn',
  message: 'Превосходная степень без факта',
};

function checkVersion(checks: readonly VersionCheck[]) {
  return {
    number: 1,
    origin: 'generated' as const,
    advertisingLabel: false,
    checks,
    createdAt: new Date('2026-10-22T10:00:00Z'),
    createdBy: { id: 'author', login: 'anna', name: null },
    title: 'Тема',
    articleMarkdown: 'Черновой текст статьи.',
    seoTitle: 'SEO',
    tags: ['ии'],
    description: 'Описание',
    imagePrompt: 'Промпт',
    disclaimerText: null,
    claims: [],
    styleVersion: 1,
    promptVersion: 'generated',
    generationRunId: null,
  };
}

describe('автопилот: цикл самокоррекции', () => {
  it('переписывает текст, пока проверки не станут чистыми, и не превышает лимит итераций', async () => {
    const events: unknown[] = [];
    const findVersion = vi.fn(async (_articleId: string, number: number) =>
      number <= 1
        ? checkVersion([BLOCKING, ...Array.from({ length: 6 }, () => WARNING)])
        : checkVersion([WARNING]),
    );
    const saveVersion = vi.fn(
      async (
        _actor: unknown,
        _articleId: string,
        _input: { readonly articleMarkdown: string },
      ) => ({
        version: { number: 2 },
        article: { id: 'article-1', version: 2, currentVersionNumber: 2 },
      }),
    );
    const generateBrief = vi.fn(async () => 'Бриф');
    const checkLimits = vi.fn(async () => undefined);
    const provider = {
      name: 'mock',
      model: 'mock-model',
      generate: vi.fn(async () => ({
        content: 'Исправленный текст статьи.',
        usage: { inputTokens: 10, outputTokens: 20 },
      })),
    };
    const runs = {
      insertRun: vi.fn(async () => 'run-1'),
      completeRun: vi.fn(async () => null),
    };
    const articles = {
      findArticle: vi.fn(async () => ({
        id: 'article-1',
        ownerId: 'author',
        status: 'idea',
        version: 1,
        styleId: 'industry-news',
        format: 'news',
        topic: 'Тема',
      })),
      listLinkedFacts: vi.fn(async () => [{ factId: 'fact-1', label: 'F1', status: 'approved' }]),
      findVersion,
    };
    const generations = {
      prepare: vi.fn(async () => ({ kind: 'run' })),
      run: vi.fn(async (_plan: unknown, emit: (event: unknown) => void) => {
        emit({ type: 'stage', stage: { stage: 'generate', status: 'running', message: 'Пишем' } });
        return { status: 'succeeded', versionNumber: 1 };
      }),
    };

    const service = new AutopilotService(
      provider as never,
      runs as never,
      { checkLimits, costOf: () => 0 } as never,
      articles as never,
      {} as never,
      { styles: new Map([['industry-news', { id: 'industry-news' }]]) } as never,
      { generateBrief, saveVersion } as unknown as ArticlesService,
      generations as unknown as GenerationService,
      extractorPrompt,
      refinerPrompt,
    );

    await service.runAutopilot({ id: 'author', role: 'author' }, 'article-1', (event) => {
      events.push(event);
    });

    expect(generateBrief).toHaveBeenCalledTimes(1);
    expect(generations.run).toHaveBeenCalledTimes(1);
    expect(saveVersion).toHaveBeenCalledTimes(1);
    expect(saveVersion.mock.calls[0]?.[2]).toMatchObject({
      articleMarkdown: 'Исправленный текст статьи.',
    });
    // Генерация + одна итерация переписывания: третьей итерации нет, проверки уже чистые.
    expect(events).toContainEqual({
      type: 'result',
      versionNumber: 2,
      iterations: 2,
      blocking: 0,
      warnings: 1,
    });
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(runs.insertRun).toHaveBeenCalledTimes(1);
    expect(runs.completeRun).toHaveBeenCalledTimes(1);
    expect(checkLimits).toHaveBeenCalled();
  });

  it('не запускается, пока хотя бы один факт не одобрен', async () => {
    const articles = {
      findArticle: vi.fn(async () => ({
        id: 'article-1',
        ownerId: 'author',
        status: 'idea',
        version: 1,
      })),
      listLinkedFacts: vi.fn(async () => [{ factId: 'fact-1', label: 'F1', status: 'draft' }]),
    };
    const service = new AutopilotService(
      {} as never,
      {} as never,
      {} as never,
      articles as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      extractorPrompt,
      refinerPrompt,
    );

    await expect(
      service.runAutopilot({ id: 'author', role: 'author' }, 'article-1', () => undefined),
    ).rejects.toThrow('одобрите все факты');
  });
});
