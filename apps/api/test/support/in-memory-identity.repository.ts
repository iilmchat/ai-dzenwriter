import { randomUUID } from 'node:crypto';
import type { UserRole } from '@dzenwriter/shared';
import type {
  ActiveSessionRow,
  AuditRecord,
  IdentityRepository,
  UserRow,
  UserUpsert,
} from '../../src/identity/identity.repository';

interface SessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  revokedAt: Date | null;
}

// Репозиторий в памяти для тестов сервисов: та же семантика, что у DrizzleIdentityRepository.
export class InMemoryIdentityRepository implements IdentityRepository {
  readonly users = new Map<string, UserRow>();
  readonly sessions = new Map<string, SessionRecord>();
  readonly audit: AuditRecord[] = [];

  async withTransaction<T>(work: (repository: IdentityRepository) => Promise<T>): Promise<T> {
    return work(this);
  }

  async findUserById(id: string): Promise<UserRow | undefined> {
    return this.users.get(id);
  }

  async findUserByGithubId(githubId: number): Promise<UserRow | undefined> {
    return [...this.users.values()].find((user) => user.githubId === githubId);
  }

  async findUserByLogin(login: string): Promise<UserRow | undefined> {
    return [...this.users.values()].find((user) => user.login === login);
  }

  async listUsers(): Promise<UserRow[]> {
    return [...this.users.values()];
  }

  async countActiveAdmins(): Promise<number> {
    return [...this.users.values()].filter(
      (user) => user.role === 'admin' && user.disabledAt === null,
    ).length;
  }

  async upsertUser(input: UserUpsert): Promise<UserRow> {
    const loginOwner = await this.findUserByLogin(input.login);
    if (loginOwner !== undefined && loginOwner.githubId !== input.githubId) {
      // Повторяем ограничение users_login_unique: сервис входа распознаёт его по коду PostgreSQL.
      const error = new Error(
        'duplicate key value violates unique constraint "users_login_unique"',
      ) as Error & {
        code: string;
      };
      error.code = '23505';
      throw error;
    }
    const existing = await this.findUserByGithubId(input.githubId);
    const user: UserRow = existing
      ? {
          ...existing,
          login: input.login,
          name: input.name,
          role: input.makeAdmin ? 'admin' : existing.role,
        }
      : {
          id: randomUUID(),
          githubId: input.githubId,
          login: input.login,
          name: input.name,
          role: input.makeAdmin ? 'admin' : 'author',
          disabledAt: null,
          createdAt: new Date(),
        };
    this.users.set(user.id, user);
    return user;
  }

  async updateUser(
    id: string,
    patch: { role: UserRole; disabledAt: Date | null },
  ): Promise<UserRow> {
    const user = this.users.get(id);
    if (!user) {
      throw new Error(`Нет пользователя ${id}`);
    }
    const updated = { ...user, role: patch.role, disabledAt: patch.disabledAt };
    this.users.set(id, updated);
    return updated;
  }

  async insertSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    const id = randomUUID();
    this.sessions.set(id, { id, ...input, revokedAt: null });
  }

  async findActiveSession(tokenHash: string, now: Date): Promise<ActiveSessionRow | undefined> {
    for (const session of this.sessions.values()) {
      if (session.tokenHash !== tokenHash || session.revokedAt || session.expiresAt <= now) {
        continue;
      }
      const user = this.users.get(session.userId);
      if (user && user.disabledAt === null) {
        return { sessionId: session.id, user };
      }
    }
    return undefined;
  }

  async revokeSession(sessionId: string, now: Date): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session && !session.revokedAt) {
      session.revokedAt = now;
    }
  }

  async revokeUserSessions(userId: string, now: Date): Promise<number> {
    let revoked = 0;
    for (const session of this.sessions.values()) {
      if (session.userId === userId && !session.revokedAt && session.expiresAt > now) {
        session.revokedAt = now;
        revoked += 1;
      }
    }
    return revoked;
  }

  async deleteInactiveSessions(now: Date): Promise<number> {
    let deleted = 0;
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now || session.revokedAt !== null) {
        this.sessions.delete(id);
        deleted += 1;
      }
    }
    return deleted;
  }

  async insertAudit(record: AuditRecord): Promise<void> {
    this.audit.push(record);
  }

  // Пользователь, уже существующий в системе (например, заведён администратором).
  addUser(fields: {
    githubId: number;
    login: string;
    role?: UserRole;
    disabledAt?: Date | null;
  }): UserRow {
    const user: UserRow = {
      id: randomUUID(),
      githubId: fields.githubId,
      login: fields.login,
      name: null,
      role: fields.role ?? 'author',
      disabledAt: fields.disabledAt ?? null,
      createdAt: new Date(),
    };
    this.users.set(user.id, user);
    return user;
  }
}
