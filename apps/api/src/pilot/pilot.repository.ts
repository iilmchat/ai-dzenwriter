import type { GenerationStatus, ReviewDecision, VersionOrigin } from '@dzenwriter/shared';
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

export interface PilotRepository {
  // Читает материалы периода и связанные с ними версии, ревью и запуски генерации.
  load(period: PilotPeriod): Promise<PilotData>;
}
