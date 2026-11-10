import type {
  ArticleFormat,
  Claim,
  GenerationStatus,
  Tone,
  VersionOrigin,
} from '@dzenwriter/shared';
import type { AuditRecord } from '../audit/audit.record';
import type { VersionCheck } from '../articles/article-rules';

export const GENERATION_REPOSITORY = Symbol('GENERATION_REPOSITORY');

// Снимок входов запуска. Тексты фактов и сам промпт сюда не попадают:
// в базе лежит только то, по чему можно понять, чем запускали.
export interface GenerationInputSnapshot {
  readonly topic: string;
  readonly styleId: string;
  readonly styleVersion: number;
  readonly format: ArticleFormat;
  readonly tone: Tone;
  readonly lengthMin: number;
  readonly lengthMax: number;
  readonly productId: string | null;
  readonly factIds: readonly string[];
  readonly factLabels: readonly string[];
  readonly promptSha256: string;
}

export interface GenerationRunRecord {
  readonly id: string;
  readonly articleId: string;
  readonly status: GenerationStatus;
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly inputSnapshot: unknown;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly latencyMs: number | null;
  readonly costUsd: string | null;
  readonly errorCode: string | null;
  readonly questions: readonly string[];
  readonly idempotencyKey: string | null;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly finishedAt: Date | null;
  readonly versionNumber: number | null;
}

// Снимок локальной правки: сам текст в базу не пишется, только размеры и инструкция.
export interface FragmentGenerationSnapshot {
  readonly kind: 'fragment';
  readonly instruction: string;
  readonly selectedChars: number;
  readonly contextBeforeChars: number;
  readonly contextAfterChars: number;
  readonly factIds: readonly string[];
  readonly factLabels: readonly string[];
  readonly promptSha256: string;
}

// Снимок генерации вариантов заголовка: бриф заменяется флагом наличия.
export interface TitlesGenerationSnapshot {
  readonly kind: 'title_options';
  readonly topic: string;
  readonly currentTitle: string;
  readonly hasBrief: boolean;
  readonly promptSha256: string;
}

export type GenerationSnapshot =
  GenerationInputSnapshot | FragmentGenerationSnapshot | TitlesGenerationSnapshot;

export interface NewGenerationRun {
  readonly articleId: string;
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly inputSnapshot: GenerationSnapshot;
  readonly idempotencyKey: string | null;
  readonly createdBy: string;
}

export interface RunCompletion {
  readonly status: GenerationStatus;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly latencyMs: number | null;
  readonly costUsd: number | null;
  readonly errorCode: string | null;
  readonly questions: readonly string[];
  readonly finishedAt: Date;
}

export interface NewVersion {
  readonly articleId: string;
  readonly origin: VersionOrigin;
  readonly title: string;
  readonly articleMarkdown: string;
  readonly seoTitle: string;
  readonly tags: readonly string[];
  readonly description: string;
  readonly imagePrompt: string;
  readonly advertisingLabel: boolean;
  readonly disclaimerText: string | null;
  readonly claims: readonly Claim[];
  readonly checks: readonly VersionCheck[];
  readonly styleVersion: number;
  readonly promptVersion: string;
  readonly generationRunId: string | null;
  readonly createdBy: string;
}

export interface GenerationRepository {
  insertRun(run: NewGenerationRun): Promise<string>;
  findRun(id: string): Promise<GenerationRunRecord | undefined>;
  findRunByIdempotencyKey(key: string): Promise<GenerationRunRecord | undefined>;
  listRuns(articleId: string, limit: number): Promise<GenerationRunRecord[]>;
  // Завершение запуска и создание версии идут одной транзакцией:
  // версия без завершённого запуска и запуск без версии — это поломанное состояние.
  completeRun(
    runId: string,
    completion: RunCompletion,
    version: NewVersion | null,
  ): Promise<number | null>;
  // Счётчики лимитов: запуски пользователя за период и потраченная стоимость.
  countRunsSince(userId: string, since: Date): Promise<number>;
  sumCostSince(since: Date): Promise<string>;
  // После рестарта API запуски, оставшиеся в running, восстановить нельзя:
  // помечаем их interrupted и возвращаем материалы для аудита и уведомлений.
  failRunningRuns(): Promise<string[]>;
  insertAudit(record: AuditRecord): Promise<void>;
}
