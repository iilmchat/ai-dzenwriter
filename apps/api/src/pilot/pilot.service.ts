import { Inject, Injectable } from '@nestjs/common';
import {
  countBlockingChecks,
  type PilotMetricsQuery,
  type PilotMetricsResponse,
} from '@dzenwriter/shared';
import {
  PILOT_REPOSITORY,
  type PilotData,
  type PilotGenerationRow,
  type PilotRepository,
  type PilotReviewRow,
} from './pilot.repository';

const HOUR_MS = 60 * 60 * 1000;
const QUESTION_LIMIT = 10;

@Injectable()
export class PilotService {
  constructor(@Inject(PILOT_REPOSITORY) private readonly repository: PilotRepository) {}

  async metrics(query: PilotMetricsQuery): Promise<PilotMetricsResponse> {
    const from = query.from === undefined ? undefined : new Date(`${query.from}T00:00:00+03:00`);
    const to = query.to === undefined ? undefined : new Date(`${query.to}T23:59:59.999+03:00`);
    const data = await this.repository.load({ from, to });
    return buildPilotMetrics(data, query);
  }
}

// Чистая сборка отчёта: в тестах можно подставить данные без HTTP и базы.
export function buildPilotMetrics(data: PilotData, query: PilotMetricsQuery): PilotMetricsResponse {
  const versionsByArticle = groupBy(data.versions);
  const reviewsByArticle = groupBy(data.reviews);
  const articleIds = new Set(data.articles.map((article) => article.id));
  const reviewedIds = [...reviewsByArticle.keys()].filter((id) => articleIds.has(id));
  const firstReviewAt = new Map<string, Date>();
  const firstApprovals = new Map<string, PilotReviewRow>();
  const ratings: number[] = [];

  for (const [articleId, reviews] of reviewsByArticle) {
    const ordered = [...reviews].sort(
      (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
    );
    const first = ordered[0];
    if (first) {
      firstReviewAt.set(articleId, first.createdAt);
    }
    const approved = ordered.find((review) => review.decision === 'approved');
    if (approved) {
      firstApprovals.set(articleId, approved);
      const latestApproved = [...ordered]
        .reverse()
        .find((review) => review.decision === 'approved' && review.rating !== null);
      if (latestApproved?.rating !== null && latestApproved?.rating !== undefined) {
        ratings.push(latestApproved.rating);
      }
    }
  }

  const approvalHours: number[] = [];
  let approvedWithoutReturn = 0;
  for (const [articleId, approval] of firstApprovals) {
    const article = data.articles.find((item) => item.id === articleId);
    if (!article) {
      continue;
    }
    const hours = (approval.createdAt.getTime() - article.createdAt.getTime()) / HOUR_MS;
    if (hours >= 0) {
      approvalHours.push(hours);
    }
    const returned = (reviewsByArticle.get(articleId) ?? []).some(
      (review) =>
        review.decision === 'changes_requested' &&
        review.createdAt.getTime() < approval.createdAt.getTime(),
    );
    if (!returned) {
      approvedWithoutReturn += 1;
    }
  }

  let gateCaught = 0;
  for (const articleId of reviewedIds) {
    const reviewAt = firstReviewAt.get(articleId);
    if (!reviewAt) {
      continue;
    }
    const caught = (versionsByArticle.get(articleId) ?? []).some(
      (version) =>
        version.createdAt.getTime() <= reviewAt.getTime() &&
        countBlockingChecks(version.checks) > 0,
    );
    if (caught) {
      gateCaught += 1;
    }
  }

  let withGeneratedVersion = 0;
  let textChangedAfterGeneration = 0;
  for (const versions of versionsByArticle.values()) {
    const generated = latestBy(
      versions.filter((version) => version.origin === 'generated'),
      (version) => version.number,
    );
    if (!generated) {
      continue;
    }
    withGeneratedVersion += 1;
    const laterManual = latestBy(
      versions.filter(
        (version) => version.number > generated.number && version.origin !== 'generated',
      ),
      (version) => version.number,
    );
    if (laterManual && laterManual.articleMarkdown !== generated.articleMarkdown) {
      textChangedAfterGeneration += 1;
    }
  }

  const runs = data.generationRuns;
  const statusCount = (status: PilotGenerationRow['status']): number =>
    runs.filter((run) => run.status === status).length;
  const questions = countQuestions(runs);
  const costUsd = round(
    runs.reduce((sum, run) => sum + run.costUsd, 0),
    4,
  );
  const articlesWithRuns = new Set(runs.map((run) => run.articleId)).size;

  return {
    period: { from: query.from ?? null, to: query.to ?? null },
    articles: {
      total: data.articles.length,
      approved: firstApprovals.size,
      reviewed: reviewedIds.length,
      approvalMedianHours: median(approvalHours),
      approvedWithoutReturn,
      approvedWithoutReturnShare: share(approvedWithoutReturn, firstApprovals.size),
      gateCaught,
      gateCaughtBeforeReviewShare: share(gateCaught, reviewedIds.length),
      withGeneratedVersion,
      textChangedAfterGeneration,
      textChangedAfterGenerationShare: share(textChangedAfterGeneration, withGeneratedVersion),
      averageRating: ratings.length === 0 ? null : round(average(ratings), 2),
      ratedArticles: ratings.length,
    },
    generation: {
      runs: runs.length,
      succeeded: statusCount('succeeded'),
      needsInput: statusCount('needs_input'),
      failed: statusCount('failed'),
      cancelled: statusCount('cancelled'),
      needsInputShare: share(statusCount('needs_input'), runs.length),
      failureShare: share(statusCount('failed'), runs.length),
      questions,
      costUsd,
      costPerArticle: articlesWithRuns === 0 ? null : round(costUsd / articlesWithRuns, 4),
    },
  };
}

function groupBy<T extends { readonly articleId: string }>(rows: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const list = groups.get(row.articleId) ?? [];
    list.push(row);
    groups.set(row.articleId, list);
  }
  return groups;
}

function latestBy<T>(items: readonly T[], number: (item: T) => number): T | undefined {
  return items.reduce<T | undefined>(
    (best, item) => (best === undefined || number(item) > number(best) ? item : best),
    undefined,
  );
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : (sorted[middle] ?? 0);
  return round(value, 1);
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function share(part: number, total: number): number | null {
  return total === 0 ? null : round(part / total, 4);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function countQuestions(
  runs: readonly PilotGenerationRow[],
): PilotMetricsResponse['generation']['questions'] {
  const counts = new Map<string, number>();
  for (const run of runs) {
    if (run.status !== 'needs_input') {
      continue;
    }
    for (const question of run.questions) {
      const text = question.trim();
      if (text.length === 0) {
        continue;
      }
      counts.set(text, (counts.get(text) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([question, count]) => ({ question, count }))
    .sort((left, right) => right.count - left.count || left.question.localeCompare(right.question))
    .slice(0, QUESTION_LIMIT);
}
