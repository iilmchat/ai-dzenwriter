import { articles, metricSnapshots, publications, users } from '@dzenwriter/db';
import type { MetricSource } from '@dzenwriter/shared';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { writeAuditRecord } from '../audit/audit.record';
import type { DbHandle } from '../database/db-handle';
import type {
  AuditRecord,
  MetricFilter,
  MetricRow,
  MetricsRepository,
  NewMetricSnapshot,
  PublicationRef,
} from './metrics.repository';

export class DrizzleMetricsRepository implements MetricsRepository {
  constructor(private readonly db: DbHandle) {}

  async listSnapshots(filter: MetricFilter): Promise<MetricRow[]> {
    const conditions = [];
    if (filter.articleId !== undefined) {
      conditions.push(eq(articles.id, filter.articleId));
    }
    if (filter.from !== undefined) {
      conditions.push(gte(metricSnapshots.capturedOn, filter.from));
    }
    if (filter.to !== undefined) {
      conditions.push(lte(metricSnapshots.capturedOn, filter.to));
    }

    const rows = await this.db
      .select({
        id: metricSnapshots.id,
        articleId: articles.id,
        topic: articles.topic,
        externalUrl: publications.externalUrl,
        capturedOn: metricSnapshots.capturedOn,
        views: metricSnapshots.views,
        reads: metricSnapshots.reads,
        avgReadSeconds: metricSnapshots.avgReadSeconds,
        source: metricSnapshots.source,
        createdByLogin: users.login,
        createdAt: metricSnapshots.createdAt,
      })
      .from(metricSnapshots)
      .innerJoin(publications, eq(publications.id, metricSnapshots.publicationId))
      .innerJoin(articles, eq(articles.id, publications.articleId))
      .innerJoin(users, eq(users.id, metricSnapshots.createdBy))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(metricSnapshots.capturedOn), desc(metricSnapshots.createdAt))
      .limit(filter.limit);

    return rows.map((row) => ({
      id: row.id,
      articleId: row.articleId,
      topic: row.topic,
      externalUrl: row.externalUrl,
      capturedOn: row.capturedOn,
      views: row.views,
      reads: row.reads,
      avgReadSeconds: row.avgReadSeconds,
      source: row.source as MetricSource,
      createdBy: row.createdByLogin,
      createdAt: row.createdAt,
    }));
  }

  async upsertSnapshot(snapshot: NewMetricSnapshot): Promise<{ id: string; created: boolean }> {
    const inserted = await this.db
      .insert(metricSnapshots)
      .values({
        publicationId: snapshot.publicationId,
        capturedOn: snapshot.capturedOn,
        views: snapshot.views,
        reads: snapshot.reads,
        avgReadSeconds: snapshot.avgReadSeconds,
        source: snapshot.source,
        createdBy: snapshot.createdBy,
      })
      .onConflictDoUpdate({
        target: [metricSnapshots.publicationId, metricSnapshots.capturedOn],
        set: {
          views: snapshot.views,
          reads: snapshot.reads,
          avgReadSeconds: snapshot.avgReadSeconds,
          source: snapshot.source,
          createdBy: snapshot.createdBy,
        },
      })
      // xmax = 0 — строка только что вставлена; у обновлённой строки xmax не нулевой.
      .returning({ id: metricSnapshots.id, inserted: sql<boolean>`xmax = 0` });

    const row = inserted[0];
    if (!row) {
      throw new Error('Снимок метрик не сохранился');
    }
    return { id: row.id, created: row.inserted };
  }

  async findPublicationByUrl(url: string): Promise<PublicationRef | undefined> {
    const rows = await this.db
      .select({
        id: publications.id,
        articleId: publications.articleId,
        externalUrl: publications.externalUrl,
      })
      .from(publications)
      .where(eq(publications.externalUrl, url))
      .limit(1);
    const [row] = rows;
    return row ? { id: row.id, articleId: row.articleId, externalUrl: row.externalUrl } : undefined;
  }

  async findPublishedPublication(articleId: string): Promise<PublicationRef | undefined> {
    const rows = await this.db
      .select({
        id: publications.id,
        articleId: publications.articleId,
        externalUrl: publications.externalUrl,
      })
      .from(publications)
      .where(and(eq(publications.articleId, articleId), eq(publications.status, 'published')))
      .orderBy(desc(publications.publishedAt))
      .limit(1);
    const [row] = rows;
    return row ? { id: row.id, articleId: row.articleId, externalUrl: row.externalUrl } : undefined;
  }

  async insertAudit(record: AuditRecord): Promise<void> {
    await writeAuditRecord(this.db, record);
  }
}
