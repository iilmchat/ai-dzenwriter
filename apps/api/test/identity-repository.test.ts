import { createDatabase } from '@dzenwriter/db';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleIdentityRepository } from '../src/identity/drizzle-identity.repository';
import { hashSessionToken } from '../src/auth/session-token';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const ROLLBACK = Symbol('rollback');
const LATER = new Date(Date.now() + 60 * 60 * 1000);

type Database = ReturnType<typeof createDatabase>;

// Аудит append-only, поэтому тестовые строки не удаляются, а откатываются транзакцией.
describe.skipIf(!testDatabaseUrl)('DrizzleIdentityRepository на PostgreSQL', () => {
  let database: Database;

  beforeAll(() => {
    database = createDatabase(testDatabaseUrl ?? '', { max: 2 });
  });

  afterAll(async () => {
    await database.client.end({ timeout: 5 });
  });

  async function inRollback(
    work: (repository: DrizzleIdentityRepository) => Promise<void>,
  ): Promise<void> {
    try {
      await database.db.transaction(async (tx) => {
        await work(new DrizzleIdentityRepository(tx));
        throw ROLLBACK;
      });
    } catch (error) {
      if (error !== ROLLBACK) {
        throw error;
      }
    }
  }

  function uniqueGithubId(): number {
    return Math.floor(Math.random() * 1_000_000_000) + 1_000_000;
  }

  it('upsert создаёт автора и повышает до администратора при makeAdmin', () =>
    inRollback(async (repository) => {
      const githubId = uniqueGithubId();
      const created = await repository.upsertUser({
        githubId,
        login: `login-${randomUUID()}`,
        name: 'Анна',
        makeAdmin: false,
      });
      expect(created.role).toBe('author');

      const promoted = await repository.upsertUser({
        githubId,
        login: created.login,
        name: 'Анна',
        makeAdmin: true,
      });
      expect(promoted).toMatchObject({ id: created.id, role: 'admin' });
      expect(await repository.findUserByGithubId(githubId)).toMatchObject({ id: created.id });
    }));

  it('активная сессия находится, а отозванная, истёкшая и сессия отключённого пользователя — нет', () =>
    inRollback(async (repository) => {
      const user = await repository.upsertUser({
        githubId: uniqueGithubId(),
        login: `login-${randomUUID()}`,
        name: null,
        makeAdmin: false,
      });
      const active = hashSessionToken(`active-${randomUUID()}`);
      const expired = hashSessionToken(`expired-${randomUUID()}`);
      await repository.insertSession({ userId: user.id, tokenHash: active, expiresAt: LATER });
      await repository.insertSession({
        userId: user.id,
        tokenHash: expired,
        expiresAt: new Date(Date.now() - 1000),
      });

      const now = new Date();
      expect(await repository.findActiveSession(active, now)).toMatchObject({
        user: { id: user.id },
      });
      expect(await repository.findActiveSession(expired, now)).toBeUndefined();

      const revoked = await repository.revokeUserSessions(user.id, now);
      expect(revoked).toBe(1);
      expect(await repository.findActiveSession(active, now)).toBeUndefined();

      const again = hashSessionToken(`again-${randomUUID()}`);
      await repository.insertSession({ userId: user.id, tokenHash: again, expiresAt: LATER });
      await repository.updateUser(user.id, { role: 'author', disabledAt: now });
      expect(await repository.findActiveSession(again, now)).toBeUndefined();
    }));

  it('удаляет истёкшие и отозванные сессии, оставляя действующие', () =>
    inRollback(async (repository) => {
      const user = await repository.upsertUser({
        githubId: uniqueGithubId(),
        login: `login-${randomUUID()}`,
        name: null,
        makeAdmin: false,
      });
      const now = new Date();
      const active = hashSessionToken(`active-${randomUUID()}`);
      const expired = hashSessionToken(`expired-${randomUUID()}`);
      const revoked = hashSessionToken(`revoked-${randomUUID()}`);
      await repository.insertSession({ userId: user.id, tokenHash: active, expiresAt: LATER });
      await repository.insertSession({
        userId: user.id,
        tokenHash: expired,
        expiresAt: new Date(now.getTime() - 1000),
      });
      await repository.insertSession({ userId: user.id, tokenHash: revoked, expiresAt: LATER });

      const revokedSession = await repository.findActiveSession(revoked, now);
      expect(revokedSession).toBeDefined();
      await repository.revokeSession(revokedSession?.sessionId ?? '', now);

      // В общей тестовой базе могут остаться сессии от других прогонов: проверяем минимум.
      expect(await repository.deleteInactiveSessions(now)).toBeGreaterThanOrEqual(2);
      expect(await repository.findActiveSession(active, now)).toMatchObject({
        user: { id: user.id },
      });
      expect(await repository.findActiveSession(revoked, now)).toBeUndefined();
      expect(await repository.deleteInactiveSessions(now)).toBe(0);
    }));

  it('счётчик администраторов не учитывает отключённых', () =>
    inRollback(async (repository) => {
      const before = await repository.countActiveAdmins();
      const admin = await repository.upsertUser({
        githubId: uniqueGithubId(),
        login: `login-${randomUUID()}`,
        name: null,
        makeAdmin: true,
      });
      expect(await repository.countActiveAdmins()).toBe(before + 1);

      await repository.updateUser(admin.id, { role: 'admin', disabledAt: new Date() });
      expect(await repository.countActiveAdmins()).toBe(before);
    }));

  it('запись в аудит сохраняется в той же транзакции', () =>
    inRollback(async (repository) => {
      await expect(
        repository.insertAudit({
          actorId: null,
          action: 'auth.denied',
          entityType: 'auth',
          entityId: 'github',
          payload: { reason: 'not_member' },
        }),
      ).resolves.toBeUndefined();
    }));
});
