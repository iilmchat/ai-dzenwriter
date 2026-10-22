import { articleVersions, createDatabase, generationRuns, users } from '@dzenwriter/db';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleArticlesRepository } from '../src/articles/drizzle-articles.repository';
import { DrizzleGenerationRepository } from '../src/generation/drizzle-generation.repository';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const ROLLBACK = Symbol('rollback');
const NOW = new Date('2026-10-22T10:00:00Z');

type Database = ReturnType<typeof createDatabase>;

// Строки откатываются транзакцией: аудит append-only, удалять тестовые данные нельзя.
describe.skipIf(!testDatabaseUrl)('DrizzleGenerationRepository на PostgreSQL', () => {
  let database: Database;

  beforeAll(() => {
    database = createDatabase(testDatabaseUrl ?? '', { max: 2 });
  });

  afterAll(async () => {
    await database.client.end({ timeout: 5 });
  });

  async function inRollback(
    work: (tx: Parameters<Parameters<Database['db']['transaction']>[0]>[0]) => Promise<void>,
  ): Promise<void> {
    try {
      await database.db.transaction(async (tx) => {
        await work(tx);
        throw ROLLBACK;
      });
    } catch (error) {
      if (error !== ROLLBACK) {
        throw error;
      }
    }
  }

  it('завершение запуска и версия пишутся одной транзакцией', () =>
    inRollback(async (tx) => {
      const [owner] = await tx
        .insert(users)
        .values({
          githubId: Math.floor(Math.random() * 1e9) + 2e9,
          login: `gen-${randomUUID()}`,
          name: 'Тест',
          role: 'author',
        })
        .returning({ id: users.id });
      if (!owner) {
        throw new Error('Пользователь не создан');
      }
      const articles = new DrizzleArticlesRepository(tx);
      const articleId = await articles.insertArticle({
        topic: 'Тестовая тема про ИИ',
        keywords: ['ИИ'],
        styleId: 'industry-news',
        format: 'news',
        tone: 'neutral',
        lengthMin: 4000,
        lengthMax: 6000,
        productId: null,
        plannedAt: null,
        ownerId: owner.id,
      });

      const repo = new DrizzleGenerationRepository(tx);
      const runId = await repo.insertRun({
        articleId,
        provider: 'mock',
        model: 'mock-dzen-writer',
        promptVersion: 'sha256:test',
        inputSnapshot: {
          topic: 'Тестовая тема про ИИ',
          styleId: 'industry-news',
          styleVersion: 1,
          format: 'news',
          tone: 'neutral',
          lengthMin: 4000,
          lengthMax: 6000,
          productId: null,
          factIds: ['F1'],
          factLabels: ['F1'],
          promptSha256: 'a'.repeat(64),
        },
        idempotencyKey: null,
        createdBy: owner.id,
      });

      const versionNumber = await repo.completeRun(
        runId,
        {
          status: 'succeeded',
          inputTokens: 100,
          outputTokens: 500,
          latencyMs: 1200,
          costUsd: 0.0123,
          errorCode: null,
          questions: [],
          finishedAt: NOW,
        },
        {
          articleId,
          origin: 'generated',
          title: 'Заголовок',
          articleMarkdown: 'Текст статьи',
          seoTitle: 'SEO-заголовок',
          tags: ['ии'],
          description: 'Описание',
          imagePrompt: 'Обложка',
          advertisingLabel: false,
          disclaimerText: null,
          claims: [{ text: 'Утверждение', type: 'fact', factIds: ['F1'] }],
          checks: [],
          styleVersion: 1,
          promptVersion: 'sha256:test',
          generationRunId: runId,
          createdBy: owner.id,
        },
      );

      expect(versionNumber).toBe(1);
      const run = await repo.findRun(runId);
      expect(run).toMatchObject({
        status: 'succeeded',
        inputTokens: 100,
        outputTokens: 500,
        latencyMs: 1200,
        versionNumber: 1,
      });
      expect(run?.costUsd).toBe('0.0123');
      expect(run?.questions).toEqual([]);

      const [stored] = await tx
        .select()
        .from(articleVersions)
        .where(eq(articleVersions.articleId, articleId));
      expect(stored).toMatchObject({
        number: 1,
        origin: 'generated',
        title: 'Заголовок',
        generationRunId: runId,
      });

      // Материал знает про новую версию и поднял блокировку.
      const article = await articles.findArticle(articleId);
      expect(article).toMatchObject({ currentVersionNumber: 1, version: 2 });
    }));

  it('needs_input сохраняет вопросы и не создаёт версию', () =>
    inRollback(async (tx) => {
      const [owner] = await tx
        .insert(users)
        .values({
          githubId: Math.floor(Math.random() * 1e9) + 2e9,
          login: `gen-${randomUUID()}`,
          name: 'Тест',
          role: 'author',
        })
        .returning({ id: users.id });
      if (!owner) {
        throw new Error('Пользователь не создан');
      }
      const articles = new DrizzleArticlesRepository(tx);
      const articleId = await articles.insertArticle({
        topic: 'Тестовая тема про ИИ',
        keywords: ['ИИ'],
        styleId: 'industry-news',
        format: 'news',
        tone: 'neutral',
        lengthMin: 4000,
        lengthMax: 6000,
        productId: null,
        plannedAt: null,
        ownerId: owner.id,
      });
      const repo = new DrizzleGenerationRepository(tx);
      const runId = await repo.insertRun({
        articleId,
        provider: 'mock',
        model: 'mock-dzen-writer',
        promptVersion: 'sha256:test',
        inputSnapshot: {
          topic: 'Тестовая тема про ИИ',
          styleId: 'industry-news',
          styleVersion: 1,
          format: 'news',
          tone: 'neutral',
          lengthMin: 4000,
          lengthMax: 6000,
          productId: null,
          factIds: [],
          factLabels: [],
          promptSha256: 'b'.repeat(64),
        },
        idempotencyKey: null,
        createdBy: owner.id,
      });

      const versionNumber = await repo.completeRun(
        runId,
        {
          status: 'needs_input',
          inputTokens: 10,
          outputTokens: 20,
          latencyMs: 300,
          costUsd: 0,
          errorCode: null,
          questions: ['Какой результат вы получили?'],
          finishedAt: NOW,
        },
        null,
      );

      expect(versionNumber).toBeNull();
      const run = await repo.findRun(runId);
      expect(run?.status).toBe('needs_input');
      expect(run?.questions).toEqual(['Какой результат вы получили?']);
      expect(run?.versionNumber).toBeNull();
    }));

  it('счётчики лимитов считают запуски и стоимость за период', () =>
    inRollback(async (tx) => {
      const [owner] = await tx
        .insert(users)
        .values({
          githubId: Math.floor(Math.random() * 1e9) + 2e9,
          login: `gen-${randomUUID()}`,
          name: 'Тест',
          role: 'author',
        })
        .returning({ id: users.id });
      if (!owner) {
        throw new Error('Пользователь не создан');
      }
      const repo = new DrizzleGenerationRepository(tx);
      const articles = new DrizzleArticlesRepository(tx);
      const articleId = await articles.insertArticle({
        topic: 'Тестовая тема про ИИ',
        keywords: ['ИИ'],
        styleId: 'industry-news',
        format: 'news',
        tone: 'neutral',
        lengthMin: 4000,
        lengthMax: 6000,
        productId: null,
        plannedAt: null,
        ownerId: owner.id,
      });

      const runId = await repo.insertRun({
        articleId,
        provider: 'mock',
        model: 'mock-dzen-writer',
        promptVersion: 'sha256:test',
        inputSnapshot: {
          topic: 'Тема',
          styleId: 'industry-news',
          styleVersion: 1,
          format: 'news',
          tone: 'neutral',
          lengthMin: 4000,
          lengthMax: 6000,
          productId: null,
          factIds: [],
          factLabels: [],
          promptSha256: 'c'.repeat(64),
        },
        idempotencyKey: null,
        createdBy: owner.id,
      });
      await repo.completeRun(
        runId,
        {
          status: 'succeeded',
          inputTokens: 1,
          outputTokens: 2,
          latencyMs: 10,
          costUsd: 0.25,
          errorCode: null,
          questions: [],
          finishedAt: NOW,
        },
        null,
      );

      expect(await repo.countRunsSince(owner.id, new Date('2026-01-01T00:00:00Z'))).toBe(1);
      expect(await repo.countRunsSince(owner.id, new Date('2027-01-01T00:00:00Z'))).toBe(0);
      expect(await repo.sumCostSince(new Date('2026-01-01T00:00:00Z'))).toBe('0.2500');
      const runs = await repo.listRuns(articleId, 10);
      expect(runs).toHaveLength(1);
      const rows = await tx.select().from(generationRuns);
      expect(rows.length).toBeGreaterThan(0);
    }));
});
