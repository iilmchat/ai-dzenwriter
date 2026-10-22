import { articleFacts, articleVersions, createDatabase, facts, users } from '@dzenwriter/db';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleArticlesRepository } from '../src/articles/drizzle-articles.repository';
import { DrizzleFactsRepository } from '../src/facts/drizzle-facts.repository';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const ROLLBACK = Symbol('rollback');
const NOW = new Date('2026-10-22T10:00:00Z');

type Database = ReturnType<typeof createDatabase>;

// Строки статей и фактов откатываются транзакцией: аудит append-only, удалять тестовые данные нельзя.
describe.skipIf(!testDatabaseUrl)('DrizzleArticlesRepository на PostgreSQL', () => {
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

  it('фильтр по владельцу скрывает архив, версия защищает от перезаписи', () =>
    inRollback(async (tx) => {
      const [owner] = await tx
        .insert(users)
        .values({
          githubId: Math.floor(Math.random() * 1e9) + 2e9,
          login: `repo-${randomUUID()}`,
          name: 'Тест',
          role: 'author',
        })
        .returning({ id: users.id });
      if (!owner) {
        throw new Error('Пользователь не создан');
      }
      const repo = new DrizzleArticlesRepository(tx);
      const articleId = await repo.insertArticle({
        topic: 'Тестовая тема',
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

      const visible = await repo.listArticles({
        ownerId: owner.id,
        includeArchived: false,
        limit: 10,
      });
      expect(visible.map((article) => article.id)).toEqual([articleId]);
      expect(visible[0]?.owner.login).toMatch(/^repo-/);

      expect(await repo.updateArticle(articleId, 99, { topic: 'Чужая правка' }, NOW)).toBe(false);
      expect(await repo.updateArticle(articleId, 1, { topic: 'Новая тема' }, NOW)).toBe(true);
      expect(await repo.findArticle(articleId)).toMatchObject({ topic: 'Новая тема', version: 2 });
    }));

  it('последняя версия, одобренные факты и связи читаются без учёта черновиков', () =>
    inRollback(async (tx) => {
      const [owner] = await tx
        .insert(users)
        .values({
          githubId: Math.floor(Math.random() * 1e9) + 2e9,
          login: `facts-${randomUUID()}`,
          name: null,
          role: 'author',
        })
        .returning({ id: users.id });
      if (!owner) {
        throw new Error('Пользователь не создан');
      }
      const repo = new DrizzleArticlesRepository(tx);
      const articleId = await repo.insertArticle({
        topic: 'Тема с фактами',
        keywords: [],
        styleId: 'company-achievements',
        format: 'case',
        tone: 'neutral',
        lengthMin: 8000,
        lengthMax: 12000,
        productId: null,
        plannedAt: null,
        ownerId: owner.id,
      });
      for (const number of [1, 2]) {
        await tx.insert(articleVersions).values({
          articleId,
          number,
          origin: 'manual',
          title: `Версия ${number}`,
          articleMarkdown: 'Текст',
          seoTitle: 'SEO',
          tags: [],
          description: 'Описание',
          imagePrompt: 'Картинка',
          checks: [{ id: 'numbers_must_map_to_facts', severity: 'block' }],
          styleVersion: 1,
          promptVersion: 'test',
          createdBy: owner.id,
        });
      }
      const [approved] = await tx
        .insert(facts)
        .values({
          type: 'company_fact',
          text: 'Факт',
          status: 'approved',
          createdBy: owner.id,
          approvedBy: owner.id,
          approvedAt: NOW,
        })
        .returning({ id: facts.id });
      const [draft] = await tx
        .insert(facts)
        .values({ type: 'company_fact', text: 'Черновик', status: 'draft', createdBy: owner.id })
        .returning({ id: facts.id });
      if (!approved || !draft) {
        throw new Error('Факты не созданы');
      }
      await tx.insert(articleFacts).values([
        { articleId, factId: approved.id, label: 'F1', addedBy: owner.id },
        { articleId, factId: draft.id, label: 'F2', addedBy: owner.id },
      ]);

      const latest = await repo.latestVersion(articleId);
      expect(latest).toMatchObject({ number: 2, origin: 'manual' });
      expect(latest?.checks).toEqual([{ id: 'numbers_must_map_to_facts', severity: 'block' }]);

      const totals = await repo.approvedFactTotals(articleId);
      expect(totals.company_fact).toEqual({ count: 1, chars: 4 });
      expect((await repo.listLinkedFacts(articleId)).map((fact) => fact.label)).toEqual([
        'F1',
        'F2',
      ]);
    }));

  it('привязка назначает метки по порядку, отвязанная метка не возвращается', () =>
    inRollback(async (tx) => {
      const [owner] = await tx
        .insert(users)
        .values({
          githubId: Math.floor(Math.random() * 1e9) + 4e9,
          login: `attach-${randomUUID()}`,
          name: null,
          role: 'author',
        })
        .returning({ id: users.id });
      if (!owner) {
        throw new Error('Пользователь не создан');
      }
      const repo = new DrizzleArticlesRepository(tx);
      const factsRepo = new DrizzleFactsRepository(tx);
      const articleId = await repo.insertArticle({
        topic: 'Тема для меток',
        keywords: [],
        styleId: 'industry-news',
        format: 'news',
        tone: 'neutral',
        lengthMin: 4000,
        lengthMax: 6000,
        productId: null,
        plannedAt: null,
        ownerId: owner.id,
      });
      const newFact = () =>
        factsRepo.insertFact({
          type: 'company_fact',
          text: 'Факт',
          sourceName: null,
          sourceUrl: null,
          sourcePublishedAt: null,
          productId: null,
          mentionsClient: false,
          clientPermission: false,
          supersedesId: null,
          createdBy: owner.id,
        });
      // Журнал аудита сервис пишет в той же транзакции, поэтому метку берём из него.
      const attach = async (factId: string) => {
        const label = await repo.attachFact(articleId, factId, owner.id);
        if (label !== undefined) {
          await repo.insertAudit({
            actorId: owner.id,
            action: 'article.fact_attach',
            entityType: 'article',
            entityId: articleId,
            payload: { factId, label },
          });
        }
        return label;
      };
      const [first, second, third] = [await newFact(), await newFact(), await newFact()];

      expect(await attach(first)).toBe('F1');
      expect(await attach(second)).toBe('F2');
      expect(await attach(first)).toBeUndefined();
      expect(await repo.detachFact(articleId, second)).toBe(true);
      expect(await attach(third)).toBe('F3');
      expect((await repo.listLinkedFacts(articleId)).map((fact) => fact.label)).toEqual([
        'F1',
        'F3',
      ]);
    }));

  it('метка продолжает номера связей, появившихся мимо журнала (как демо-данные)', () =>
    inRollback(async (tx) => {
      const [owner] = await tx
        .insert(users)
        .values({
          githubId: Math.floor(Math.random() * 1e9) + 5e9,
          login: `seeded-${randomUUID()}`,
          name: null,
          role: 'author',
        })
        .returning({ id: users.id });
      if (!owner) {
        throw new Error('Пользователь не создан');
      }
      const repo = new DrizzleArticlesRepository(tx);
      const factsRepo = new DrizzleFactsRepository(tx);
      const articleId = await repo.insertArticle({
        topic: 'Тема со старой связью',
        keywords: [],
        styleId: 'industry-news',
        format: 'news',
        tone: 'neutral',
        lengthMin: 4000,
        lengthMax: 6000,
        productId: null,
        plannedAt: null,
        ownerId: owner.id,
      });
      const newFact = () =>
        factsRepo.insertFact({
          type: 'news_source',
          text: 'Цитата',
          sourceName: null,
          sourceUrl: 'https://example.com/news/1',
          sourcePublishedAt: '2026-10-20',
          productId: null,
          mentionsClient: false,
          clientPermission: false,
          supersedesId: null,
          createdBy: owner.id,
        });
      const seeded = await newFact();
      await tx
        .insert(articleFacts)
        .values({ articleId, factId: seeded, label: 'F1', addedBy: owner.id });

      expect(await repo.attachFact(articleId, await newFact(), owner.id)).toBe('F2');
    }));
});
