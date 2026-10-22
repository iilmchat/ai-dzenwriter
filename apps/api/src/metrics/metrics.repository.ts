import type { MetricSource } from '@dzenwriter/shared';

export const METRICS_REPOSITORY = Symbol('METRICS_REPOSITORY');

export interface MetricRow {
  readonly id: string;
  readonly articleId: string;
  readonly topic: string;
  readonly externalUrl: string | null;
  readonly capturedOn: string;
  readonly views: number;
  readonly reads: number;
  readonly avgReadSeconds: number | null;
  readonly source: MetricSource;
  readonly createdBy: string;
  readonly createdAt: Date;
}

// Публикация, к которой относится снимок метрик.
export interface PublicationRef {
  readonly id: string;
  readonly articleId: string;
  readonly externalUrl: string | null;
}

export interface MetricFilter {
  readonly articleId?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly limit: number;
}

export interface NewMetricSnapshot {
  readonly publicationId: string;
  readonly capturedOn: string;
  readonly views: number;
  readonly reads: number;
  readonly avgReadSeconds: number | null;
  readonly source: MetricSource;
  readonly createdBy: string;
}

export interface MetricsRepository {
  listSnapshots(filter: MetricFilter): Promise<MetricRow[]>;
  // Снимок на дату один: повторный ввод обновляет прежний, а не плодит строки.
  upsertSnapshot(snapshot: NewMetricSnapshot): Promise<{ id: string; created: boolean }>;
  findPublicationByUrl(url: string): Promise<PublicationRef | undefined>;
  findPublishedPublication(articleId: string): Promise<PublicationRef | undefined>;
  insertAudit(record: AuditRecord): Promise<void>;
}

export interface AuditRecord {
  readonly actorId: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly payload: Record<string, unknown>;
}
