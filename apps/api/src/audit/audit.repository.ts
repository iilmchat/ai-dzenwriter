export const AUDIT_REPOSITORY = Symbol('AUDIT_REPOSITORY');

export interface AuditRow {
  readonly id: number;
  readonly actorId: string | null;
  readonly actorLogin: string | null;
  readonly actorName: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly payload: Record<string, unknown>;
  readonly createdAt: Date;
}

export interface AuditFilter {
  readonly actorId?: string | undefined;
  readonly action?: string | undefined;
  readonly entityType?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  // На единицу больше лимита страницы: так сервис узнаёт, что журнал обрезан.
  readonly limit: number;
}

export interface AuditRepository {
  // Свежие записи раньше старых, при равном времени — по убыванию номера.
  listEntries(filter: AuditFilter): Promise<AuditRow[]>;
}
