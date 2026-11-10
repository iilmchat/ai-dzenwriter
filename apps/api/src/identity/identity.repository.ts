import type { UserRole } from '@dzenwriter/shared';
import type { AuditRecord } from '../audit/audit.record';

export const IDENTITY_REPOSITORY = Symbol('IDENTITY_REPOSITORY');

export interface UserRow {
  readonly id: string;
  readonly githubId: number;
  readonly login: string;
  readonly name: string | null;
  readonly role: UserRole;
  readonly disabledAt: Date | null;
  readonly createdAt: Date;
}

export interface ActiveSessionRow {
  readonly sessionId: string;
  readonly user: UserRow;
}

export type { AuditRecord } from '../audit/audit.record';

export interface UserUpsert {
  readonly githubId: number;
  readonly login: string;
  readonly name: string | null;
  readonly makeAdmin: boolean;
}

// Связанные записи (вход, смена роли, отзыв сессий) сервисы собирают в withTransaction:
// либо сохраняется всё, либо ничего.
export interface IdentityRepository {
  withTransaction<T>(work: (repository: IdentityRepository) => Promise<T>): Promise<T>;
  findUserById(id: string): Promise<UserRow | undefined>;
  findUserByGithubId(githubId: number): Promise<UserRow | undefined>;
  findUserByLogin(login: string): Promise<UserRow | undefined>;
  listUsers(): Promise<UserRow[]>;
  countActiveAdmins(): Promise<number>;
  upsertUser(input: UserUpsert): Promise<UserRow>;
  updateUser(id: string, patch: { role: UserRole; disabledAt: Date | null }): Promise<UserRow>;
  insertSession(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void>;
  findActiveSession(tokenHash: string, now: Date): Promise<ActiveSessionRow | undefined>;
  revokeSession(sessionId: string, now: Date): Promise<void>;
  revokeUserSessions(userId: string, now: Date): Promise<number>;
  deleteInactiveSessions(now: Date): Promise<number>;
  insertAudit(record: AuditRecord): Promise<void>;
}
