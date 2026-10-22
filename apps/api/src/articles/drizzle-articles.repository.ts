import {
  articleFacts,
  articles,
  articleVersions,
  facts,
  publications,
  reviews,
  users,
} from '@dzenwriter/db';
import type {
  ArticleFormat,
  ArticleStatus,
  CheckSeverity,
  FactType,
  Tone,
  VersionOrigin,
} from '@dzenwriter/shared';
import { and, count, desc, eq, gte, lte, ne, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { writeAuditRecord, type AuditRecord } from '../audit/audit.record';
import type { DbHandle } from '../database/db-handle';
import { emptyFactTotals, type FactTotals, type VersionCheck } from './article-rules';
import {
  type ArticleChanges,
  type ArticleFilter,
  type ArticlesRepository,
  type ArticleView,
  type LinkedFactRecord,
  type NewArticle,
  type NewPublication,
  type NewReview,
  type PublicationRecord,
  type ReviewRecord,
  type VersionRecord,
} from './articles.repository';

const ownerUser = alias(users, 'owner');
const reviewerUser = alias(users, 'reviewer');
const authorUser = alias(users, 'author');

const articleSelection = {
  id: articles.id,
  topic: articles.topic,
  keywords: articles.keywords,
  title: articles.title,
  styleId: articles.styleId,
  format: articles.format,
  tone: articles.tone,
  lengthMin: articles.lengthMin,
  lengthMax: articles.lengthMax,
  productId: articles.productId,
  status: articles.status,
  ownerId: articles.ownerId,
  reviewerId: articles.reviewerId,
  currentVersionNumber: articles.currentVersionNumber,
  plannedAt: articles.plannedAt,
  version: articles.version,
  createdAt: articles.createdAt,
  updatedAt: articles.updatedAt,
  archivedAt: articles.archivedAt,
  ownerLogin: ownerUser.login,
  ownerName: ownerUser.name,
  reviewerLogin: reviewerUser.login,
  reviewerName: reviewerUser.name,
};

interface ArticleSelectRow {
  id: string;
  topic: string;
  keywords: string[];
  title: string | null;
  styleId: string;
  format: string;
  tone: string;
  lengthMin: number;
  lengthMax: number;
  productId: string | null;
  status: string;
  ownerId: string;
  reviewerId: string | null;
  currentVersionNumber: number | null;
  plannedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  ownerLogin: string;
  ownerName: string | null;
  reviewerLogin: string | null;
  reviewerName: string | null;
}

const versionSelection = {
  number: articleVersions.number,
  origin: articleVersions.origin,
  advertisingLabel: articleVersions.advertisingLabel,
  checks: articleVersions.checks,
  createdAt: articleVersions.createdAt,
  creatorId: authorUser.id,
  creatorLogin: authorUser.login,
  creatorName: authorUser.name,
};

interface VersionSelectRow {
  number: number;
  origin: string;
  advertisingLabel: boolean;
  checks: unknown;
  createdAt: Date;
  creatorId: string;
  creatorLogin: string;
  creatorName: string | null;
}

export class DrizzleArticlesRepository implements ArticlesRepository {
  constructor(private readonly db: DbHandle) {}

  withTransaction<T>(work: (repository: ArticlesRepository) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(new DrizzleArticlesRepository(tx)));
  }

  async listArticles(filter: ArticleFilter): Promise<ArticleView[]> {
    const conditions: SQL[] = [];
    if (!filter.includeArchived) {
      conditions.push(ne(articles.status, 'archived'));
    }
    if (filter.status) {
      conditions.push(eq(articles.status, filter.status));
    }
    if (filter.styleId) {
      conditions.push(eq(articles.styleId, filter.styleId));
    }
    if (filter.ownerId) {
      conditions.push(eq(articles.ownerId, filter.ownerId));
    }
    if (filter.plannedFrom) {
      conditions.push(gte(articles.plannedAt, filter.plannedFrom));
    }
    if (filter.plannedTo) {
      conditions.push(lte(articles.plannedAt, filter.plannedTo));
    }
    const rows: ArticleSelectRow[] = await this.db
      .select(articleSelection)
      .from(articles)
      .innerJoin(ownerUser, eq(ownerUser.id, articles.ownerId))
      .leftJoin(reviewerUser, eq(reviewerUser.id, articles.reviewerId))
      .where(and(...conditions))
      .orderBy(desc(articles.updatedAt))
      .limit(filter.limit);
    return rows.map(toArticleView);
  }

  async findArticle(id: string): Promise<ArticleView | undefined> {
    const rows: ArticleSelectRow[] = await this.db
      .select(articleSelection)
      .from(articles)
      .innerJoin(ownerUser, eq(ownerUser.id, articles.ownerId))
      .leftJoin(reviewerUser, eq(reviewerUser.id, articles.reviewerId))
      .where(eq(articles.id, id))
      .limit(1);
    const [row] = rows;
    return row ? toArticleView(row) : undefined;
  }

  async insertArticle(article: NewArticle): Promise<string> {
    const [row] = await this.db
      .insert(articles)
      .values({
        topic: article.topic,
        keywords: [...article.keywords],
        styleId: article.styleId,
        format: article.format,
        tone: article.tone,
        lengthMin: article.lengthMin,
        lengthMax: article.lengthMax,
        productId: article.productId,
        plannedAt: article.plannedAt,
        status: 'idea',
        ownerId: article.ownerId,
      })
      .returning({ id: articles.id });
    return requireRow(row).id;
  }

  async updateArticle(
    id: string,
    expectedVersion: number,
    changes: ArticleChanges,
    now: Date,
  ): Promise<boolean> {
    const updated = await this.db
      .update(articles)
      .set({
        topic: changes.topic,
        keywords: changes.keywords ? [...changes.keywords] : undefined,
        styleId: changes.styleId,
        format: changes.format,
        tone: changes.tone,
        lengthMin: changes.lengthMin,
        lengthMax: changes.lengthMax,
        productId: changes.productId,
        plannedAt: changes.plannedAt,
        status: changes.status,
        reviewerId: changes.reviewerId,
        archivedAt: changes.archivedAt,
        version: sql`${articles.version} + 1`,
        updatedAt: now,
      })
      .where(and(eq(articles.id, id), eq(articles.version, expectedVersion)))
      .returning({ id: articles.id });
    return updated.length === 1;
  }

  async latestVersion(articleId: string): Promise<VersionRecord | undefined> {
    const [row] = await fetchVersions(this.db, articleId, 1);
    return row ? toVersionRecord(row) : undefined;
  }

  async listVersions(articleId: string, limit: number): Promise<VersionRecord[]> {
    return (await fetchVersions(this.db, articleId, limit)).map(toVersionRecord);
  }

  async listReviews(articleId: string, limit: number): Promise<ReviewRecord[]> {
    const rows = await this.db
      .select({
        decision: reviews.decision,
        comment: reviews.comment,
        versionNumber: reviews.versionNumber,
        createdAt: reviews.createdAt,
        reviewerId: reviewerUser.id,
        reviewerLogin: reviewerUser.login,
        reviewerName: reviewerUser.name,
      })
      .from(reviews)
      .innerJoin(reviewerUser, eq(reviewerUser.id, reviews.reviewerId))
      .where(eq(reviews.articleId, articleId))
      .orderBy(desc(reviews.createdAt))
      .limit(limit);
    return rows.map((row) => ({
      decision: row.decision as ReviewRecord['decision'],
      comment: row.comment,
      versionNumber: row.versionNumber,
      reviewer: { id: row.reviewerId, login: row.reviewerLogin, name: row.reviewerName },
      createdAt: row.createdAt,
    }));
  }

  async listPublications(articleId: string): Promise<PublicationRecord[]> {
    const rows = await this.db
      .select({
        channel: publications.channel,
        status: publications.status,
        externalUrl: publications.externalUrl,
        scheduledAt: publications.scheduledAt,
        publishedAt: publications.publishedAt,
      })
      .from(publications)
      .where(eq(publications.articleId, articleId))
      .orderBy(desc(publications.createdAt));
    return rows.map((row) => ({
      channel: row.channel as PublicationRecord['channel'],
      status: row.status as PublicationRecord['status'],
      externalUrl: row.externalUrl,
      scheduledAt: row.scheduledAt,
      publishedAt: row.publishedAt,
    }));
  }

  async listLinkedFacts(articleId: string): Promise<LinkedFactRecord[]> {
    const rows = await this.db
      .select({
        label: articleFacts.label,
        type: facts.type,
        status: facts.status,
        sourceName: facts.sourceName,
      })
      .from(articleFacts)
      .innerJoin(facts, eq(facts.id, articleFacts.factId))
      .where(eq(articleFacts.articleId, articleId))
      .orderBy(articleFacts.label);
    return rows.map((row) => ({
      label: row.label,
      type: row.type as FactType,
      status: row.status as LinkedFactRecord['status'],
      sourceName: row.sourceName,
    }));
  }

  // Одобренные факты материала по типам: нужны для условий стиля. Тексты фактов не читаем.
  async approvedFactTotals(articleId: string): Promise<FactTotals> {
    const rows = await this.db
      .select({
        type: facts.type,
        total: count(),
        chars: sql<number>`coalesce(sum(length(${facts.text})), 0)::int`,
      })
      .from(articleFacts)
      .innerJoin(facts, eq(facts.id, articleFacts.factId))
      .where(and(eq(articleFacts.articleId, articleId), eq(facts.status, 'approved')))
      .groupBy(facts.type);
    const totals = emptyFactTotals();
    for (const row of rows) {
      totals[row.type as FactType] = { count: row.total, chars: Number(row.chars) };
    }
    return totals;
  }

  async insertReview(review: NewReview): Promise<void> {
    await this.db.insert(reviews).values({
      articleId: review.articleId,
      versionNumber: review.versionNumber,
      reviewerId: review.reviewerId,
      decision: review.decision,
      comment: review.comment,
    });
  }

  async insertPublication(publication: NewPublication): Promise<void> {
    await this.db.insert(publications).values({
      articleId: publication.articleId,
      channel: publication.channel,
      status: publication.status,
      scheduledAt: publication.scheduledAt,
      publishedAt: publication.publishedAt,
      externalUrl: publication.externalUrl,
      createdBy: publication.createdBy,
    });
  }

  async insertAudit(record: AuditRecord): Promise<void> {
    await writeAuditRecord(this.db, record);
  }
}

async function fetchVersions(
  db: DbHandle,
  articleId: string,
  limit: number,
): Promise<VersionSelectRow[]> {
  return db
    .select(versionSelection)
    .from(articleVersions)
    .innerJoin(authorUser, eq(authorUser.id, articleVersions.createdBy))
    .where(eq(articleVersions.articleId, articleId))
    .orderBy(desc(articleVersions.number))
    .limit(limit);
}

function toArticleView(row: ArticleSelectRow): ArticleView {
  return {
    id: row.id,
    topic: row.topic,
    keywords: row.keywords,
    title: row.title,
    styleId: row.styleId,
    format: row.format as ArticleFormat,
    tone: row.tone as Tone,
    lengthMin: row.lengthMin,
    lengthMax: row.lengthMax,
    productId: row.productId,
    status: row.status as ArticleStatus,
    ownerId: row.ownerId,
    reviewerId: row.reviewerId,
    currentVersionNumber: row.currentVersionNumber,
    plannedAt: row.plannedAt,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
    owner: { id: row.ownerId, login: row.ownerLogin, name: row.ownerName },
    reviewer:
      row.reviewerId !== null && row.reviewerLogin !== null
        ? { id: row.reviewerId, login: row.reviewerLogin, name: row.reviewerName }
        : null,
  };
}

function toVersionRecord(row: VersionSelectRow): VersionRecord {
  return {
    number: row.number,
    origin: row.origin as VersionOrigin,
    advertisingLabel: row.advertisingLabel,
    checks: parseChecks(row.checks),
    createdAt: row.createdAt,
    createdBy: { id: row.creatorId, login: row.creatorLogin, name: row.creatorName },
  };
}

// Поле checks в БД — jsonb, поэтому читаем осторожно: битые записи не должны ронять чтение.
function parseChecks(raw: unknown): VersionCheck[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((item: unknown): VersionCheck[] => {
    if (typeof item !== 'object' || item === null) {
      return [];
    }
    const { id, severity, message } = item as Record<string, unknown>;
    if (typeof id !== 'string' || !isSeverity(severity)) {
      return [];
    }
    return [{ id, severity, ...(typeof message === 'string' ? { message } : {}) }];
  });
}

function isSeverity(value: unknown): value is CheckSeverity {
  return value === 'block' || value === 'warn' || value === 'info';
}

function requireRow<T>(row: T | undefined): T {
  if (!row) {
    throw new Error('Запись не сохранилась');
  }
  return row;
}
