import { articles, publications } from '@dzenwriter/db';
import type { ArticleStatus } from '@dzenwriter/shared';
import { desc, eq, inArray, max } from 'drizzle-orm';
import type { DbHandle } from '../database/db-handle';
import type { PublicationRow, PublicationsRepository } from './publications.repository';

const PUBLICATION_STATUSES: readonly ArticleStatus[] = ['approved', 'scheduled', 'published'];

export class DrizzlePublicationsRepository implements PublicationsRepository {
  constructor(private readonly db: DbHandle) {}

  async listForPublication(): Promise<PublicationRow[]> {
    const rows = await this.db
      .select({
        articleId: articles.id,
        topic: articles.topic,
        styleId: articles.styleId,
        status: articles.status,
        version: articles.version,
        currentVersionNumber: articles.currentVersionNumber,
        plannedAt: articles.plannedAt,
        // У материала бывают две записи: запланированная и опубликованная. Берём последние.
        publishedAt: max(publications.publishedAt),
        externalUrl: max(publications.externalUrl),
      })
      .from(articles)
      .leftJoin(publications, eq(publications.articleId, articles.id))
      .where(inArray(articles.status, [...PUBLICATION_STATUSES]))
      .groupBy(articles.id)
      .orderBy(desc(articles.updatedAt));

    return rows.map((row) => ({
      articleId: row.articleId,
      topic: row.topic,
      styleId: row.styleId,
      status: row.status as ArticleStatus,
      version: row.version,
      currentVersionNumber: row.currentVersionNumber,
      plannedAt: row.plannedAt,
      publishedAt: row.publishedAt,
      externalUrl: row.externalUrl,
    }));
  }
}
