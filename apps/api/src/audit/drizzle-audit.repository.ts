import { auditLog, users } from '@dzenwriter/db';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import type { DbHandle } from '../database/db-handle';
import type { AuditFilter, AuditRepository, AuditRow } from './audit.repository';

export class DrizzleAuditRepository implements AuditRepository {
  constructor(private readonly db: DbHandle) {}

  async listEntries(filter: AuditFilter): Promise<AuditRow[]> {
    const conditions = [];
    if (filter.actorId !== undefined) {
      conditions.push(eq(auditLog.actorId, filter.actorId));
    }
    if (filter.action !== undefined) {
      conditions.push(eq(auditLog.action, filter.action));
    }
    if (filter.entityType !== undefined) {
      conditions.push(eq(auditLog.entityType, filter.entityType));
    }
    if (filter.from !== undefined) {
      conditions.push(gte(auditLog.createdAt, new Date(filter.from)));
    }
    if (filter.to !== undefined) {
      conditions.push(lte(auditLog.createdAt, new Date(filter.to)));
    }

    const rows = await this.db
      .select({
        id: auditLog.id,
        actorId: auditLog.actorId,
        actorLogin: users.login,
        actorName: users.name,
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        payload: auditLog.payload,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      // Пользователь мог быть удалён: тогда actor_id обнулился триггером внешнего ключа
      // и запись остаётся с пустым исполнителем.
      .leftJoin(users, eq(users.id, auditLog.actorId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(filter.limit);

    return rows.map((row) => ({
      id: row.id,
      actorId: row.actorId,
      actorLogin: row.actorLogin,
      actorName: row.actorName,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      payload: row.payload,
      createdAt: row.createdAt,
    }));
  }
}
