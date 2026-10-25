import type { AuditFilter, AuditRepository, AuditRow } from '../../src/audit/audit.repository';

// Журнал в памяти: та же семантика, что у DrizzleAuditRepository.
export class InMemoryAuditRepository implements AuditRepository {
  readonly rows: AuditRow[] = [];

  addEntry(entry: {
    readonly actorId?: string | null;
    readonly actorLogin?: string | null;
    readonly actorName?: string | null;
    readonly action: string;
    readonly entityType: string;
    readonly entityId: string;
    readonly payload?: Record<string, unknown>;
    readonly createdAt?: Date;
  }): void {
    this.rows.push({
      id: this.rows.length + 1,
      actorId: entry.actorId ?? null,
      actorLogin: entry.actorLogin ?? null,
      actorName: entry.actorName ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      payload: entry.payload ?? {},
      createdAt: entry.createdAt ?? new Date(),
    });
  }

  async listEntries(filter: AuditFilter): Promise<AuditRow[]> {
    return this.rows
      .filter((row) => filter.actorId === undefined || row.actorId === filter.actorId)
      .filter((row) => filter.action === undefined || row.action === filter.action)
      .filter((row) => filter.entityType === undefined || row.entityType === filter.entityType)
      .filter((row) => filter.from === undefined || row.createdAt.toISOString() >= filter.from)
      .filter((row) => filter.to === undefined || row.createdAt.toISOString() <= filter.to)
      .sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id - left.id,
      )
      .slice(0, filter.limit);
  }
}
