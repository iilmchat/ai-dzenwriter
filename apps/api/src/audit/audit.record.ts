import { auditLog } from '@dzenwriter/db';
import type { DbHandle } from '../database/db-handle';

export interface AuditRecord {
  readonly actorId: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly payload: Record<string, unknown>;
}

// Журнал append-only: триггер БД запрещает правки и удаления, поэтому пишем только вставки.
export async function writeAuditRecord(db: DbHandle, record: AuditRecord): Promise<void> {
  await db.insert(auditLog).values({
    actorId: record.actorId,
    action: record.action,
    entityType: record.entityType,
    entityId: record.entityId,
    payload: record.payload,
  });
}
