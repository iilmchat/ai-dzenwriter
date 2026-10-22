import { createDatabase, users } from '@dzenwriter/db';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleFactsRepository } from '../src/facts/drizzle-facts.repository';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const ROLLBACK = Symbol('rollback');
const NOW = new Date('2026-10-22T10:00:00Z');
// Слово без совпадений в демо-данных: поиск по нему находит только строки этого теста.
const UNIQUE_WORD = 'xqzvkplmtoken';

type Database = ReturnType<typeof createDatabase>;

const NEW_FACT = {
  sourceName: null,
  sourceUrl: null,
  sourcePublishedAt: null,
  productId: null,
  mentionsClient: false,
  clientPermission: false,
  supersedesId: null,
};

// Строки фактов откатываются транзакцией: аудит append-only, удалять тестовые данные нельзя.
describe.skipIf(!testDatabaseUrl)('DrizzleFactsRepository на PostgreSQL', () => {
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

  async function insertUser(tx: Parameters<Parameters<Database['db']['transaction']>[0]>[0]) {
    const [row] = await tx
      .insert(users)
      .values({
        githubId: Math.floor(Math.random() * 1e9) + 3e9,
        login: `facts-${randomUUID()}`,
        name: 'Тест',
        role: 'author',
      })
      .returning({ id: users.id });
    if (!row) {
      throw new Error('Пользователь не создан');
    }
    return row.id;
  }

  it('правка с устаревшей версией не проходит, актуальная увеличивает версию', () =>
    inRollback(async (tx) => {
      const owner = await insertUser(tx);
      const repo = new DrizzleFactsRepository(tx);
      const id = await repo.insertFact({
        ...NEW_FACT,
        type: 'company_fact',
        text: 'Факт',
        createdBy: owner,
      });

      expect(await repo.updateFact(id, 5, { text: 'Чужая правка' }, NOW)).toBe(false);
      expect(await repo.updateFact(id, 1, { text: 'Новый текст' }, NOW)).toBe(true);
      expect(await repo.findFact(id)).toMatchObject({
        text: 'Новый текст',
        version: 2,
        status: 'draft',
        createdBy: { id: owner },
      });
    }));

  it('поиск находит тексты, исходный одобренный факт помечен исправлением на проверке', () =>
    inRollback(async (tx) => {
      const owner = await insertUser(tx);
      const repo = new DrizzleFactsRepository(tx);
      const original = await repo.insertFact({
        ...NEW_FACT,
        type: 'company_fact',
        text: `Команда ${UNIQUE_WORD} проверяет ответы`,
        createdBy: owner,
      });
      await repo.updateFact(
        original,
        1,
        { status: 'approved', approvedBy: owner, approvedAt: NOW },
        NOW,
      );
      const correction = await repo.insertFact({
        ...NEW_FACT,
        type: 'company_fact',
        text: `Исправление ${UNIQUE_WORD}`,
        supersedesId: original,
        createdBy: owner,
      });

      const found = await repo.listFacts({ query: UNIQUE_WORD, limit: 10 });

      expect(found.map((fact) => fact.id).sort()).toEqual([original, correction].sort());
      expect(found.find((fact) => fact.id === original)).toMatchObject({
        status: 'approved',
        hasPendingCorrection: true,
        approvedBy: { id: owner },
      });
      expect(found.find((fact) => fact.id === correction)).toMatchObject({
        supersedesId: original,
        hasPendingCorrection: false,
      });
    }));
});
