import { auditLog, sessions, users } from '@dzenwriter/db';
import type { UserRole } from '@dzenwriter/shared';
import { and, count, eq, gt, isNull } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import type {
  ActiveSessionRow,
  AuditRecord,
  IdentityRepository,
  UserRow,
  UserUpsert,
} from './identity.repository';

// Подключение либо корневое, либо транзакционное: так работает withTransaction.
type DbHandle = PgDatabase<PostgresJsQueryResultHKT, Record<string, never>>;
type UserRecord = typeof users.$inferSelect;

export class DrizzleIdentityRepository implements IdentityRepository {
  constructor(private readonly db: DbHandle) {}

  withTransaction<T>(work: (repository: IdentityRepository) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(new DrizzleIdentityRepository(tx)));
  }

  async findUserById(id: string): Promise<UserRow | undefined> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ? toUserRow(row) : undefined;
  }

  async findUserByGithubId(githubId: number): Promise<UserRow | undefined> {
    const [row] = await this.db.select().from(users).where(eq(users.githubId, githubId)).limit(1);
    return row ? toUserRow(row) : undefined;
  }

  async listUsers(): Promise<UserRow[]> {
    const rows = await this.db.select().from(users).orderBy(users.createdAt, users.login);
    return rows.map(toUserRow);
  }

  async countActiveAdmins(): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(users)
      .where(and(eq(users.role, 'admin'), isNull(users.disabledAt)));
    return row?.total ?? 0;
  }

  async upsertUser(input: UserUpsert): Promise<UserRow> {
    const [row] = await this.db
      .insert(users)
      .values({
        githubId: input.githubId,
        login: input.login,
        name: input.name,
        role: input.makeAdmin ? 'admin' : 'author',
      })
      .onConflictDoUpdate({
        target: users.githubId,
        set: {
          login: input.login,
          name: input.name,
          ...(input.makeAdmin ? { role: 'admin' } : {}),
        },
      })
      .returning();
    return toUserRow(requireRow(row));
  }

  async updateUser(
    id: string,
    patch: { role: UserRole; disabledAt: Date | null },
  ): Promise<UserRow> {
    const [row] = await this.db
      .update(users)
      .set({ role: patch.role, disabledAt: patch.disabledAt })
      .where(eq(users.id, id))
      .returning();
    return toUserRow(requireRow(row));
  }

  async insertSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.db.insert(sessions).values({
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
    });
  }

  // Активная сессия: не отозвана, не истекла, пользователь не отключён.
  async findActiveSession(tokenHash: string, now: Date): Promise<ActiveSessionRow | undefined> {
    const [row] = await this.db
      .select({ sessionId: sessions.id, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now),
          isNull(users.disabledAt),
        ),
      )
      .limit(1);
    return row ? { sessionId: row.sessionId, user: toUserRow(row.user) } : undefined;
  }

  async revokeSession(sessionId: string, now: Date): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
  }

  // Считаются только действовавшие сессии: истёкшие отзывать уже незачем и в аудит их не пишем.
  async revokeUserSessions(userId: string, now: Date): Promise<number> {
    const revoked = await this.db
      .update(sessions)
      .set({ revokedAt: now })
      .where(
        and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)),
      )
      .returning({ id: sessions.id });
    return revoked.length;
  }

  async insertAudit(record: AuditRecord): Promise<void> {
    await this.db.insert(auditLog).values({
      actorId: record.actorId,
      action: record.action,
      entityType: record.entityType,
      entityId: record.entityId,
      payload: record.payload,
    });
  }
}

function toUserRow(row: UserRecord): UserRow {
  return {
    id: row.id,
    githubId: row.githubId,
    login: row.login,
    name: row.name,
    role: row.role as UserRole,
    disabledAt: row.disabledAt,
    createdAt: row.createdAt,
  };
}

function requireRow<T>(row: T | undefined): T {
  if (!row) {
    throw new Error('Запись не сохранилась');
  }
  return row;
}
