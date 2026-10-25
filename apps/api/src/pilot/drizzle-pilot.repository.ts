import { articleVersions, articles, generationRuns, reviews } from '@dzenwriter/db';
import type { GenerationStatus, ReviewDecision, VersionOrigin } from '@dzenwriter/shared';
import { and, asc, gte, inArray, lte, type SQL } from 'drizzle-orm';
import type { VersionCheck } from '../articles/article-rules';
import type { DbHandle } from '../database/db-handle';
import {
  type PilotArticleRow,
  type PilotData,
  type PilotGenerationRow,
  type PilotPeriod,
  type PilotRepository,
  type PilotReviewRow,
  type PilotVersionRow,
} from './pilot.repository';

export class DrizzlePilotRepository implements PilotRepository {
  constructor(private readonly db: DbHandle) {}

  async load(period: PilotPeriod): Promise<PilotData> {
    const conditions: SQL[] = [];
    if (period.from) {
      conditions.push(gte(articles.createdAt, period.from));
    }
    if (period.to) {
      conditions.push(lte(articles.createdAt, period.to));
    }
    const articleRows: PilotArticleRow[] = await this.db
      .select({ id: articles.id, topic: articles.topic, createdAt: articles.createdAt })
      .from(articles)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(articles.createdAt));
    const articleIds = articleRows.map((article) => article.id);
    if (articleIds.length === 0) {
      return { articles: [], versions: [], reviews: [], generationRuns: [] };
    }

    const [versionRows, reviewRows, generationRows] = await Promise.all([
      this.db
        .select({
          articleId: articleVersions.articleId,
          number: articleVersions.number,
          origin: articleVersions.origin,
          articleMarkdown: articleVersions.articleMarkdown,
          checks: articleVersions.checks,
          createdAt: articleVersions.createdAt,
        })
        .from(articleVersions)
        .where(inArray(articleVersions.articleId, articleIds))
        .orderBy(asc(articleVersions.articleId), asc(articleVersions.number)),
      this.db
        .select({
          articleId: reviews.articleId,
          decision: reviews.decision,
          rating: reviews.rating,
          rubricAccuracy: reviews.rubricAccuracy,
          rubricStyle: reviews.rubricStyle,
          rubricReadability: reviews.rubricReadability,
          rubricHooks: reviews.rubricHooks,
          rubricCliches: reviews.rubricCliches,
          createdAt: reviews.createdAt,
        })
        .from(reviews)
        .where(inArray(reviews.articleId, articleIds))
        .orderBy(asc(reviews.createdAt)),
      this.db
        .select({
          articleId: generationRuns.articleId,
          status: generationRuns.status,
          costUsd: generationRuns.costUsd,
          questions: generationRuns.questions,
          createdAt: generationRuns.createdAt,
        })
        .from(generationRuns)
        .where(inArray(generationRuns.articleId, articleIds))
        .orderBy(asc(generationRuns.createdAt)),
    ]);

    const versions: PilotVersionRow[] = versionRows.map((row) => ({
      articleId: row.articleId,
      number: row.number,
      origin: row.origin as VersionOrigin,
      articleMarkdown: row.articleMarkdown,
      checks: arrayOfChecks(row.checks),
      createdAt: row.createdAt,
    }));
    const reviewRowsMapped: PilotReviewRow[] = reviewRows.map((row) => ({
      articleId: row.articleId,
      decision: row.decision as ReviewDecision,
      rating: row.rating,
      rubric:
        row.rubricAccuracy === null ||
        row.rubricStyle === null ||
        row.rubricReadability === null ||
        row.rubricHooks === null ||
        row.rubricCliches === null
          ? null
          : {
              accuracy: row.rubricAccuracy,
              style: row.rubricStyle,
              readability: row.rubricReadability,
              hooks: row.rubricHooks,
              cliches: row.rubricCliches,
            },
      createdAt: row.createdAt,
    }));
    const generationRowsMapped: PilotGenerationRow[] = generationRows.map((row) => ({
      articleId: row.articleId,
      status: row.status as GenerationStatus,
      costUsd: Number(row.costUsd ?? 0),
      questions: arrayOfStrings(row.questions),
      createdAt: row.createdAt,
    }));

    return {
      articles: articleRows,
      versions,
      reviews: reviewRowsMapped,
      generationRuns: generationRowsMapped,
    };
  }
}

function arrayOfChecks(value: unknown): VersionCheck[] {
  return Array.isArray(value) ? (value as VersionCheck[]) : [];
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}
