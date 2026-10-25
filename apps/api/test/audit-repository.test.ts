import { createDatabase, users } from '@dzenwriter/db';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleAuditRepository } from '../src/audit/drizzle-audit.repository';
import { writeAuditRecord } from '../src/audit/audit.record';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const ROLLBACK = Symbol('rollback');

// Тестовая сущность с уникальным типом: в рабочей базе уже есть записи аудита,
// поэтому выборки фильтруются по типу test-записей, чтобы не задевать их.
const TEST_ENTITY = 'audit_repo_test';

type Database = ReturnType<typeof createDatabase>;

describe.skipIf(!testDatabaseUrl)('DrizzleAuditRepository на PostgreSQL', () => {
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

  it('читает записи с фильтрами: исполнитель, действие, период', () =>
    inRollback(async (tx) => {
      const adminId = randomUUID();
      await tx.insert(users).values({
        id: adminId,
        githubId: 9001,
        login: 'anna',
        name: null,
        role: 'admin',
      });

      await writeAuditRecord(tx, {
        actorId: adminId,
        action: 'fact.create',
        entityType: TEST_ENTITY,
        entityId: randomUUID(),
        payload: { type: 'company_fact' },
      });
      await writeAuditRecord(tx, {
        actorId: null,
        action: 'auth.denied',
        entityType: TEST_ENTITY,
        entityId: randomUUID(),
        payload: {},
      });
      await writeAuditRecord(tx, {
        actorId: adminId,
        action: 'article.transition',
        entityType: TEST_ENTITY,
        entityId: randomUUID(),
        payload: { from: 'drafting', to: 'in_review' },
      });

      const repository = new DrizzleAuditRepository(tx);

      const all = await repository.listEntries({ entityType: TEST_ENTITY, limit: 10 });
      expect(all).toHaveLength(3);
      // От новых к старым.
      expect(all.map((row) => row.action)).toEqual([
        'article.transition',
        'auth.denied',
        'fact.create',
      ]);
      expect(all[2]?.actorLogin).toBe('anna');
      // Запись без исполнителя остаётся читаемой.
      expect(all[1]?.actorId).toBeNull();
      expect(all[1]?.actorLogin).toBeNull();

      const byAction = await repository.listEntries({
        action: 'auth.denied',
        entityType: TEST_ENTITY,
        limit: 10,
      });
      expect(byAction.map((row) => row.action)).toEqual(['auth.denied']);

      const byActor = await repository.listEntries({
        actorId: adminId,
        entityType: TEST_ENTITY,
        limit: 10,
      });
      expect(byActor.map((row) => row.action)).toEqual(['article.transition', 'fact.create']);
    }));

  it('период включает границы и обрезается по лимиту', () =>
    inRollback(async (tx) => {
      await writeAuditRecord(tx, {
        actorId: null,
        action: 'article.update',
        entityType: TEST_ENTITY,
        entityId: 'a1',
        payload: {},
      });
      await writeAuditRecord(tx, {
        actorId: null,
        action: 'article.update',
        entityType: TEST_ENTITY,
        entityId: 'a2',
        payload: {},
      });

      const repository = new DrizzleAuditRepository(tx);

      // created_at в транзакции один и тот же: границы с запасом в час с обеих сторон.
      const now = new Date();
      const around = await repository.listEntries({
        entityType: TEST_ENTITY,
        from: new Date(now.getTime() - 3_600_000).toISOString(),
        to: new Date(now.getTime() + 3_600_000).toISOString(),
        limit: 10,
      });
      expect(around.map((row) => row.entityId).sort()).toEqual(['a1', 'a2']);

      const paged = await repository.listEntries({ entityType: TEST_ENTITY, limit: 1 });
      expect(paged).toHaveLength(1);
    }));
});
