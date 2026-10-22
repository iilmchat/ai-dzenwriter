import { createDatabase } from '@dzenwriter/db';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleCatalogRepository } from '../src/catalog/drizzle-catalog.repository';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const ROLLBACK = Symbol('rollback');
const NOW = new Date('2026-10-22T10:00:00Z');

type Database = ReturnType<typeof createDatabase>;

// Продукты откатываются транзакцией: тестовые строки не остаются в справочнике.
describe.skipIf(!testDatabaseUrl)('DrizzleCatalogRepository на PostgreSQL', () => {
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

  it('продукт архивируется и возвращается, удаления нет', () =>
    inRollback(async (tx) => {
      const repo = new DrizzleCatalogRepository(tx);
      const slug = `catalog-${randomUUID()}`;
      const id = await repo.insertProduct({ slug, name: 'Тест', oneLiner: 'Описание' });

      expect(await repo.findProductBySlug(slug)).toMatchObject({ id, archived: false });

      await repo.updateProduct(id, { archivedAt: NOW });
      expect(await repo.findProduct(id)).toMatchObject({ archived: true, name: 'Тест' });

      await repo.updateProduct(id, { archivedAt: null, name: 'Новое название' });
      expect(await repo.findProduct(id)).toMatchObject({
        archived: false,
        name: 'Новое название',
        slug,
      });
    }));
});
