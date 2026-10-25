import { Inject, Injectable } from '@nestjs/common';
import type { AuditEntry, AuditListResponse, AuditQuery } from '@dzenwriter/shared';
import { AUDIT_REPOSITORY, type AuditRepository, type AuditRow } from './audit.repository';

// Текущая страница журнала: без пагинации, старые записи разворачиваются фильтрами периода.
const AUDIT_LIMIT = 500;

// Журнал действий: append-only, читает только администратор.
@Injectable()
export class AuditService {
  constructor(@Inject(AUDIT_REPOSITORY) private readonly repository: AuditRepository) {}

  async list(query: AuditQuery): Promise<AuditListResponse> {
    const rows = await this.repository.listEntries({ ...query, limit: AUDIT_LIMIT + 1 });
    return {
      items: rows.slice(0, AUDIT_LIMIT).map(toEntry),
      truncated: rows.length > AUDIT_LIMIT,
    };
  }
}

function toEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    actorId: row.actorId,
    actorLogin: row.actorLogin,
    actorName: row.actorName,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    payload: row.payload,
    createdAt: row.createdAt.toISOString(),
  };
}
