import type {
  GenerationStatus,
  ReviewDecision,
  ReviewRubric,
  VersionOrigin,
} from '@dzenwriter/shared';
import type { VersionCheck } from '../articles/article-rules';

export const PILOT_REPOSITORY = Symbol('PILOT_REPOSITORY');

export interface PilotPeriod {
  readonly from?: Date | undefined;
  readonly to?: Date | undefined;
}

export interface PilotArticleRow {
  readonly id: string;
  readonly topic: string;
  readonly createdAt: Date;
}

export interface PilotVersionRow {
  readonly articleId: string;
  readonly number: number;
  readonly origin: VersionOrigin;
  readonly articleMarkdown: string;
  readonly checks: readonly VersionCheck[];
  readonly createdAt: Date;
}

export interface PilotReviewRow {
  readonly articleId: string;
  readonly decision: ReviewDecision;
  readonly rating: number | null;
  readonly rubric: ReviewRubric | null;
  readonly createdAt: Date;
}

export interface PilotGenerationRow {
  readonly articleId: string;
  readonly status: GenerationStatus;
  readonly costUsd: number;
  readonly questions: readonly string[];
  readonly createdAt: Date;
}

export interface PilotData {
  readonly articles: readonly PilotArticleRow[];
  readonly versions: readonly PilotVersionRow[];
  readonly reviews: readonly PilotReviewRow[];
  readonly generationRuns: readonly PilotGenerationRow[];
}

// Строка агрегата generation_runs: SQL группирует по стилю, версии промпта и статусу.
// Стоимость и задержка суммируются, количество задержек нужно для среднего.
export interface PilotGenerationStatRow {
  readonly styleId: string;
  readonly promptVersion: string;
  readonly status: GenerationStatus;
  readonly runs: number;
  readonly costUsd: number;
  readonly latencyTotalMs: number;
  readonly latencyCount: number;
}

export interface PilotRepository {
  // Читает материалы периода и связанные с ними версии, ревью и запуски генерации.
  load(period: PilotPeriod): Promise<PilotData>;
  // Агрегаты запусков за период: по стилю, версии промпта и статусу.
  getGenerationStats(period: PilotPeriod): Promise<PilotGenerationStatRow[]>;
}
