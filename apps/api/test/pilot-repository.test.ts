import {
  articleVersions,
  articles,
  createDatabase,
  generationRuns,
  reviews,
  users,
} from '@dzenwriter/db';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzlePilotRepository } from '../src/pilot/drizzle-pilot.repository';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const ROLLBACK = Symbol('rollback');
const CREATED_AT = new Date('2026-02-01T10:00:00Z');

type Database = ReturnType<typeof createDatabase>;

describe.skipIf(!testDatabaseUrl)('DrizzlePilotRepository на PostgreSQL', () => {
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

  it('читает материалы периода и связанные версии, ревью и запуски', () =>
    inRollback(async (tx) => {
      const [owner] = await tx
        .insert(users)
        .values({
          githubId: Math.floor(Math.random() * 1e9) + 3e9,
          login: `pilot-${randomUUID()}`,
          name: null,
          role: 'reviewer',
        })
        .returning({ id: users.id });
      if (!owner) {
        throw new Error('Пользователь не создан');
      }
      const [article] = await tx
        .insert(articles)
        .values({
          topic: 'Отчёт пилота',
          keywords: ['ИИ'],
          styleId: 'industry-news',
          format: 'news',
          tone: 'neutral',
          lengthMin: 4000,
          lengthMax: 6000,
          status: 'approved',
          ownerId: owner.id,
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
        })
        .returning({ id: articles.id });
      if (!article) {
        throw new Error('Материал не создан');
      }
      await tx.insert(articleVersions).values({
        articleId: article.id,
        number: 1,
        origin: 'generated',
        title: 'Заголовок',
        articleMarkdown: 'Текст',
        seoTitle: 'SEO',
        tags: ['ии'],
        description: 'Описание',
        imagePrompt: 'Обложка',
        styleVersion: 1,
        promptVersion: 'sha256:test',
        createdBy: owner.id,
        createdAt: CREATED_AT,
      });
      await tx.insert(reviews).values({
        articleId: article.id,
        versionNumber: 1,
        reviewerId: owner.id,
        decision: 'approved',
        rating: 5,
        rubricAccuracy: 4,
        rubricStyle: 4,
        rubricReadability: 5,
        rubricHooks: 4,
        rubricCliches: 3,
        createdAt: CREATED_AT,
      });
      await tx.insert(generationRuns).values({
        articleId: article.id,
        status: 'needs_input',
        provider: 'mock',
        model: 'mock',
        promptVersion: 'sha256:test',
        questions: ['Нужен источник'],
        costUsd: '0.0100',
        createdBy: owner.id,
        createdAt: CREATED_AT,
      });

      const data = await new DrizzlePilotRepository(tx).load({
        from: new Date('2026-02-01T00:00:00Z'),
        to: new Date('2026-02-02T00:00:00Z'),
      });

      expect(data.articles).toHaveLength(1);
      expect(data.versions).toMatchObject([{ articleId: article.id, number: 1 }]);
      expect(data.reviews).toMatchObject([
        {
          articleId: article.id,
          decision: 'approved',
          rating: 5,
          rubric: { accuracy: 4, style: 4, readability: 5, hooks: 4, cliches: 3 },
        },
      ]);
      expect(data.generationRuns).toMatchObject([
        { articleId: article.id, status: 'needs_input', costUsd: 0.01 },
      ]);
      expect(data.generationRuns[0]?.questions).toEqual(['Нужен источник']);
    }));
});
