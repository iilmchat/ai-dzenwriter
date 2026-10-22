import { createDatabase, users } from '@dzenwriter/db';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleArticlesRepository } from '../src/articles/drizzle-articles.repository';
import { DrizzleMetricsRepository } from '../src/metrics/drizzle-metrics.repository';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const ROLLBACK = Symbol('rollback');

type Database = ReturnType<typeof createDatabase>;

describe.skipIf(!testDatabaseUrl)('DrizzleMetricsRepository на PostgreSQL', () => {
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

  it('снимок на дату один: повторный ввод обновляет прежний', () =>
    inRollback(async (tx) => {
      const [owner] = await tx
        .insert(users)
        .values({
          githubId: Math.floor(Math.random() * 1e9) + 2e9,
          login: `metrics-${randomUUID()}`,
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
        styleId: 'company-achievements',
        format: 'case',
        tone: 'neutral',
        lengthMin: 8000,
        lengthMax: 12000,
        productId: null,
        plannedAt: null,
        ownerId: owner.id,
      });
      const repo = new DrizzleMetricsRepository(tx);
      const externalUrl = `https://dzen.ru/a/${randomUUID()}`;
      await articles.insertPublication({
        articleId,
        channel: 'dzen',
        status: 'published',
        scheduledAt: null,
        publishedAt: new Date(),
        externalUrl,
        createdBy: owner.id,
      });
      const published = await repo.findPublishedPublication(articleId);
      if (!published) {
        throw new Error('Публикация не найдена');
      }
      expect(published.externalUrl).toBe(externalUrl);

      const first = await repo.upsertSnapshot({
        publicationId: published.id,
        capturedOn: '2026-11-01',
        views: 100,
        reads: 20,
        avgReadSeconds: 60,
        source: 'manual',
        createdBy: owner.id,
      });
      const second = await repo.upsertSnapshot({
        publicationId: published.id,
        capturedOn: '2026-11-01',
        views: 250,
        reads: 60,
        avgReadSeconds: null,
        source: 'csv',
        createdBy: owner.id,
      });
      const third = await repo.upsertSnapshot({
        publicationId: published.id,
        capturedOn: '2026-11-02',
        views: 400,
        reads: 90,
        avgReadSeconds: null,
        source: 'csv',
        createdBy: owner.id,
      });

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.id).toBe(first.id);
      expect(third.created).toBe(true);

      const rows = await repo.listSnapshots({ articleId, limit: 10 });
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        capturedOn: '2026-11-02',
        views: 400,
        reads: 90,
        source: 'csv',
        externalUrl,
      });

      const found = await repo.findPublicationByUrl(externalUrl);
      expect(found?.articleId).toBe(articleId);
    }));
});
