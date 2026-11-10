import { Inject, Injectable } from '@nestjs/common';
import {
  countBlockingChecks,
  type PilotMetricsQuery,
  type PilotMetricsResponse,
  type ReviewRubric,
} from '@dzenwriter/shared';
import type { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/tokens';
import {
  PILOT_REPOSITORY,
  type PilotData,
  type PilotGenerationRow,
  type PilotGenerationStatRow,
  type PilotRepository,
  type PilotReviewRow,
} from './pilot.repository';

const HOUR_MS = 60 * 60 * 1000;
const QUESTION_LIMIT = 10;

// Средние по каждому критерию рубрики редактора (7.4 дизайна): разбивка рядом с общей оценкой.
function rubricAverages(
  rubrics: ReviewRubric[],
): PilotMetricsResponse['articles']['averageRubric'] {
  const criterion = (pick: (rubric: ReviewRubric) => number): number | null =>
    rubrics.length === 0 ? null : round(average(rubrics.map(pick)), 2);
  return {
    accuracy: criterion((rubric) => rubric.accuracy),
    style: criterion((rubric) => rubric.style),
    readability: criterion((rubric) => rubric.readability),
    hooks: criterion((rubric) => rubric.hooks),
    cliches: criterion((rubric) => rubric.cliches),
  };
}

@Injectable()
export class PilotService {
  constructor(
    @Inject(PILOT_REPOSITORY) private readonly repository: PilotRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async metrics(query: PilotMetricsQuery): Promise<PilotMetricsResponse> {
    const from = query.from === undefined ? undefined : new Date(`${query.from}T00:00:00+03:00`);
    const to = query.to === undefined ? undefined : new Date(`${query.to}T23:59:59.999+03:00`);
    const [data, generationStats] = await Promise.all([
      this.repository.load({ from, to }),
      this.repository.getGenerationStats({ from, to }),
    ]);
    const styleNames = new Map(
      [...this.config.styles.values()].map((style) => [style.id, style.name]),
    );
    return buildPilotMetrics(data, query, generationStats, styleNames);
  }
}

// Чистая сборка отчёта: в тестах можно подставить данные без HTTP и базы.
export function buildPilotMetrics(
  data: PilotData,
  query: PilotMetricsQuery,
  generationStats: readonly PilotGenerationStatRow[] = [],
  styleNames: ReadonlyMap<string, string> = new Map(),
): PilotMetricsResponse {
  const versionsByArticle = groupBy(data.versions);
  const reviewsByArticle = groupBy(data.reviews);
  const articleIds = new Set(data.articles.map((article) => article.id));
  const reviewedIds = [...reviewsByArticle.keys()].filter((id) => articleIds.has(id));
  const firstReviewAt = new Map<string, Date>();
  const firstApprovals = new Map<string, PilotReviewRow>();
  const ratings: number[] = [];
  const rubrics: ReviewRubric[] = [];

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
      const latestRubric = [...ordered]
        .reverse()
        .find((review) => review.decision === 'approved' && review.rubric !== null);
      if (latestRubric?.rubric) {
        rubrics.push(latestRubric.rubric);
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
  const breakdown = generationBreakdown(generationStats, styleNames);

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
      averageRubric: rubricAverages(rubrics),
      rubricRatedArticles: rubrics.length,
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
      byStyle: breakdown.byStyle,
      byPromptVersion: breakdown.byPromptVersion,
    },
  };
}

interface GenerationAccumulator {
  totalRuns: number;
  succeeded: number;
  failed: number;
  needsInput: number;
  totalCostUsd: number;
  latencyTotalMs: number;
  latencyCount: number;
}

function emptyAccumulator(): GenerationAccumulator {
  return {
    totalRuns: 0,
    succeeded: 0,
    failed: 0,
    needsInput: 0,
    totalCostUsd: 0,
    latencyTotalMs: 0,
    latencyCount: 0,
  };
}

// Сырые агрегаты SQL раскладываются по двум разрезам: стиль и версия промпта.
function generationBreakdown(
  stats: readonly PilotGenerationStatRow[],
  styleNames: ReadonlyMap<string, string>,
): Pick<PilotMetricsResponse['generation'], 'byStyle' | 'byPromptVersion'> {
  const styles = new Map<string, GenerationAccumulator>();
  const prompts = new Map<string, GenerationAccumulator>();

  for (const row of stats) {
    addRun(styles, row.styleId, row);
    addRun(prompts, row.promptVersion, row);
  }

  return {
    byStyle: [...styles.entries()]
      .map(([styleId, value]) => ({
        styleId,
        styleName: styleNames.get(styleId) ?? styleId,
        ...accumulated(value),
        avgLatencyMs:
          value.latencyCount === 0 ? null : round(value.latencyTotalMs / value.latencyCount, 1),
      }))
      .sort(
        (left, right) =>
          right.totalRuns - left.totalRuns || left.styleId.localeCompare(right.styleId),
      ),
    byPromptVersion: [...prompts.entries()]
      .map(([promptVersion, value]) => ({
        promptVersion,
        ...accumulated(value),
      }))
      .sort(
        (left, right) =>
          right.totalRuns - left.totalRuns || left.promptVersion.localeCompare(right.promptVersion),
      ),
  };
}

function addRun(
  groups: Map<string, GenerationAccumulator>,
  key: string,
  row: PilotGenerationStatRow,
): void {
  const value = groups.get(key) ?? emptyAccumulator();
  value.totalRuns += row.runs;
  value.totalCostUsd += row.costUsd;
  value.latencyTotalMs += row.latencyTotalMs;
  value.latencyCount += row.latencyCount;
  if (row.status === 'succeeded') {
    value.succeeded += row.runs;
  }
  if (row.status === 'failed') {
    value.failed += row.runs;
  }
  if (row.status === 'needs_input') {
    value.needsInput += row.runs;
  }
  groups.set(key, value);
}

function accumulated(
  value: GenerationAccumulator,
): Pick<
  GenerationAccumulator,
  'totalRuns' | 'succeeded' | 'failed' | 'needsInput' | 'totalCostUsd'
> {
  return {
    totalRuns: value.totalRuns,
    succeeded: value.succeeded,
    failed: value.failed,
    needsInput: value.needsInput,
    totalCostUsd: round(value.totalCostUsd, 4),
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
