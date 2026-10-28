import { randomUUID } from 'node:crypto';
import type { AuditRecord } from '../../src/metrics/metrics.repository';
import type {
  MetricFilter,
  MetricRow,
  MetricsRepository,
  NewMetricSnapshot,
  PublicationRef,
} from '../../src/metrics/metrics.repository';

// Метрики в памяти: та же семантика, что у DrizzleMetricsRepository.
export class InMemoryMetricsRepository implements MetricsRepository {
  readonly snapshots: MetricRow[] = [];
  readonly publications: PublicationRef[] = [];
  readonly audit: AuditRecord[] = [];
  readonly clock = new Date();

  addPublication(publication: PublicationRef): void {
    this.publications.push(publication);
  }

  async listSnapshots(filter: MetricFilter): Promise<MetricRow[]> {
    return this.snapshots
      .filter((row) => filter.articleId === undefined || row.articleId === filter.articleId)
      .filter((row) => filter.from === undefined || row.capturedOn >= filter.from)
      .filter((row) => filter.to === undefined || row.capturedOn <= filter.to)
      .sort((left, right) => right.capturedOn.localeCompare(left.capturedOn))
      .slice(0, filter.limit);
  }

  async upsertSnapshot(snapshot: NewMetricSnapshot): Promise<{ id: string; created: boolean }> {
    const existing = this.snapshots.find(
      (row) =>
        row.articleId ===
          this.publications.find((item) => item.id === snapshot.publicationId)?.articleId &&
        row.capturedOn === snapshot.capturedOn,
    );
    if (existing) {
      const index = this.snapshots.indexOf(existing);
      this.snapshots[index] = {
        ...existing,
        views: snapshot.views,
        reads: snapshot.reads,
        avgReadSeconds: snapshot.avgReadSeconds,
        source: snapshot.source,
        createdBy: snapshot.createdBy,
      };
      return { id: existing.id, created: false };
    }
    const publication = this.publications.find((item) => item.id === snapshot.publicationId);
    const id = randomUUID();
    this.snapshots.push({
      id,
      articleId: publication?.articleId ?? '',
      topic: 'Тема',
      externalUrl: publication?.externalUrl ?? null,
      capturedOn: snapshot.capturedOn,
      views: snapshot.views,
      reads: snapshot.reads,
      avgReadSeconds: snapshot.avgReadSeconds,
      source: snapshot.source,
      createdBy: snapshot.createdBy,
      createdAt: this.clock,
    });
    return { id, created: true };
  }

  async findSnapshotBefore(
    publicationId: string,
    capturedOn: string,
  ): Promise<MetricRow | undefined> {
    const publication = this.publications.find((item) => item.id === publicationId);
    if (!publication) {
      return undefined;
    }
    const previous = this.snapshots
      .filter((row) => row.articleId === publication.articleId && row.capturedOn < capturedOn)
      .sort((left, right) => right.capturedOn.localeCompare(left.capturedOn));
    return previous[0];
  }

  async findPublicationByUrl(url: string): Promise<PublicationRef | undefined> {
    return this.publications.find((item) => item.externalUrl === url);
  }

  async findPublishedPublication(articleId: string): Promise<PublicationRef | undefined> {
    return this.publications.find((item) => item.articleId === articleId);
  }

  async insertAudit(record: AuditRecord): Promise<void> {
    this.audit.push(record);
  }
}
