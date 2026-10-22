import {
  articleFacts,
  articleGenerationConfirmations,
  articles,
  articleVersions,
  auditLog,
  facts,
  publications,
  reviews,
  users,
} from '@dzenwriter/db';
import type {
  ArticleFormat,
  ArticleStatus,
  CheckSeverity,
  FactStatus,
  FactType,
  Tone,
  VersionClaim,
  VersionOrigin,
} from '@dzenwriter/shared';
import { and, count, desc, eq, gte, lte, ne, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { writeAuditRecord, type AuditRecord } from '../audit/audit.record';
import type { DbHandle } from '../database/db-handle';
import { emptyFactTotals, type FactTotals, type VersionCheck } from './article-rules';
import { insertVersion, type NewVersionRecord } from './version-writer';
import {
  type ArticleChanges,
  type ArticleFilter,
  type ArticlesRepository,
  type ArticleView,
  type GenerationConfirmationRecord,
  type LinkedFactRecord,
  type NewArticle,
  type NewPublication,
  type NewReview,
  type PublicationRecord,
  type ReviewRecord,
  type VersionContent,
  type VersionRecord,
} from './articles.repository';

const ownerUser = alias(users, 'owner');
const reviewerUser = alias(users, 'reviewer');
const authorUser = alias(users, 'author');
const confirmUser = alias(users, 'confirm');

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
  title?: string;
  articleMarkdown?: string;
  seoTitle?: string;
  tags?: string[];
  description?: string;
  imagePrompt?: string;
  disclaimerText?: string | null;
  claims?: unknown;
  styleVersion?: number;
  promptVersion?: string;
  generationRunId?: string | null;
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

  async findVersion(articleId: string, number: number): Promise<VersionContent | undefined> {
    const rows = await this.db
      .select({
        ...versionSelection,
        title: articleVersions.title,
        articleMarkdown: articleVersions.articleMarkdown,
        seoTitle: articleVersions.seoTitle,
        tags: articleVersions.tags,
        description: articleVersions.description,
        imagePrompt: articleVersions.imagePrompt,
        disclaimerText: articleVersions.disclaimerText,
        claims: articleVersions.claims,
        styleVersion: articleVersions.styleVersion,
        promptVersion: articleVersions.promptVersion,
        generationRunId: articleVersions.generationRunId,
      })
      .from(articleVersions)
      .innerJoin(authorUser, eq(authorUser.id, articleVersions.createdBy))
      .where(and(eq(articleVersions.articleId, articleId), eq(articleVersions.number, number)))
      .limit(1);
    const [row] = rows;
    if (!row) {
      return undefined;
    }
    return {
      ...toVersionRecord(row),
      title: row.title,
      articleMarkdown: row.articleMarkdown,
      seoTitle: row.seoTitle,
      tags: row.tags,
      description: row.description,
      imagePrompt: row.imagePrompt,
      disclaimerText: row.disclaimerText,
      claims: parseClaims(row.claims),
      styleVersion: row.styleVersion,
      promptVersion: row.promptVersion,
      generationRunId: row.generationRunId,
    };
  }

  async insertVersion(version: NewVersionRecord, now: Date): Promise<number> {
    return insertVersion(this.db, version, now);
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
        factId: facts.id,
        label: articleFacts.label,
        type: facts.type,
        status: facts.status,
        text: facts.text,
        sourceName: facts.sourceName,
        sourceUrl: facts.sourceUrl,
        sourcePublishedAt: facts.sourcePublishedAt,
        mentionsClient: facts.mentionsClient,
        clientPermission: facts.clientPermission,
      })
      .from(articleFacts)
      .innerJoin(facts, eq(facts.id, articleFacts.factId))
      .where(eq(articleFacts.articleId, articleId));
    return rows
      .map((row) => ({
        factId: row.factId,
        label: row.label,
        type: row.type as FactType,
        status: row.status as FactStatus,
        text: row.text,
        sourceName: row.sourceName,
        sourceUrl: row.sourceUrl,
        sourcePublishedAt: row.sourcePublishedAt,
        mentionsClient: row.mentionsClient,
        clientPermission: row.clientPermission,
      }))
      .sort((left, right) => labelNumber(left.label) - labelNumber(right.label));
  }

  async attachFact(
    articleId: string,
    factId: string,
    addedBy: string,
  ): Promise<string | undefined> {
    // Блокировка строки материала: два одновременных привязывания не получат одну метку.
    await this.db
      .select({ id: articles.id })
      .from(articles)
      .where(eq(articles.id, articleId))
      .for('update');
    const [existing] = await this.db
      .select({ factId: articleFacts.factId })
      .from(articleFacts)
      .where(and(eq(articleFacts.articleId, articleId), eq(articleFacts.factId, factId)))
      .limit(1);
    if (existing) {
      return undefined;
    }
    // Номер не повторяется: берём наибольший из текущих связей и из журнала. Отвязанная метка
    // остаётся в журнале, иначе старые ссылки в версиях указывали бы на другой факт.
    const linked = await this.db
      .select({ label: articleFacts.label })
      .from(articleFacts)
      .where(eq(articleFacts.articleId, articleId));
    const [logged] = await this.db
      .select({
        value: sql<number>`coalesce(max(case when ${auditLog.payload}->>'label' ~ '^F[0-9]+$' then substring(${auditLog.payload}->>'label' from 2)::int end), 0)`,
      })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityType, 'article'),
          eq(auditLog.entityId, articleId),
          eq(auditLog.action, 'article.fact_attach'),
        ),
      );
    const highest = Math.max(
      Number(logged?.value ?? 0),
      ...linked.map((row) => labelNumber(row.label)),
    );
    const label = `F${highest + 1}`;
    await this.db.insert(articleFacts).values({ articleId, factId, label, addedBy });
    return label;
  }

  async detachFact(articleId: string, factId: string): Promise<boolean> {
    const removed = await this.db
      .delete(articleFacts)
      .where(and(eq(articleFacts.articleId, articleId), eq(articleFacts.factId, factId)))
      .returning({ factId: articleFacts.factId });
    return removed.length === 1;
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

  async findGenerationConfirmation(
    articleId: string,
  ): Promise<GenerationConfirmationRecord | undefined> {
    const rows = await this.db
      .select({
        confirmedBy: confirmUser.id,
        confirmedByLogin: confirmUser.login,
        confirmedByName: confirmUser.name,
        confirmedAt: articleGenerationConfirmations.confirmedAt,
      })
      .from(articleGenerationConfirmations)
      .innerJoin(confirmUser, eq(confirmUser.id, articleGenerationConfirmations.confirmedBy))
      .where(eq(articleGenerationConfirmations.articleId, articleId))
      .limit(1);
    const [row] = rows;
    if (!row) {
      return undefined;
    }
    return {
      confirmedBy: {
        id: row.confirmedBy,
        login: row.confirmedByLogin,
        name: row.confirmedByName,
      },
      confirmedAt: row.confirmedAt,
    };
  }

  async insertGenerationConfirmation(articleId: string, confirmedBy: string): Promise<void> {
    await this.db
      .insert(articleGenerationConfirmations)
      .values({ articleId, confirmedBy })
      .onConflictDoNothing();
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
    const record = item as Record<string, unknown>;
    const { id, severity, message, start, end, excerpt, decision, comment, confirmedBy } = record;
    if (
      typeof id !== 'string' ||
      !isSeverity(severity) ||
      typeof message !== 'string' ||
      (decision !== undefined && decision !== 'confirmed')
    ) {
      return [];
    }
    return [
      {
        id,
        severity,
        message,
        ...(typeof start === 'number' ? { start } : {}),
        ...(typeof end === 'number' ? { end } : {}),
        ...(typeof excerpt === 'string' ? { excerpt } : {}),
        ...(decision === 'confirmed' ? { decision } : {}),
        ...(typeof comment === 'string' ? { comment } : {}),
        ...(typeof confirmedBy === 'string' ? { confirmedBy } : {}),
        ...(typeof record.confirmedAt === 'string' ? { confirmedAt: record.confirmedAt } : {}),
      },
    ];
  });
}

// claims в БД — jsonb: битые записи не должны ронять чтение.
function parseClaims(raw: unknown): VersionClaim[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((item: unknown): VersionClaim[] => {
    if (typeof item !== 'object' || item === null) {
      return [];
    }
    const record = item as Record<string, unknown>;
    const { text, type, factIds, start, end } = record;
    if (
      typeof text !== 'string' ||
      (type !== 'fact' && type !== 'hypothesis' && type !== 'opinion') ||
      !Array.isArray(factIds)
    ) {
      return [];
    }
    return [
      {
        text,
        type,
        factIds: factIds.filter((id): id is string => typeof id === 'string'),
        ...(typeof start === 'number' ? { start } : {}),
        ...(typeof end === 'number' ? { end } : {}),
      },
    ];
  });
}

function isSeverity(value: unknown): value is CheckSeverity {
  return value === 'block' || value === 'warn' || value === 'info';
}

// Метки F1, F2, … сортируем по номеру: строковый порядок ставит F10 раньше F2.
function labelNumber(label: string): number {
  const match = /^F(\d+)$/.exec(label);
  return match?.[1] ? Number(match[1]) : 0;
}

function requireRow<T>(row: T | undefined): T {
  if (!row) {
    throw new Error('Запись не сохранилась');
  }
  return row;
}
