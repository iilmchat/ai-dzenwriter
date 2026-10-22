import { randomUUID } from 'node:crypto';
import type { GenerationStatus } from '@dzenwriter/shared';
import type { AuditRecord } from '../../src/audit/audit.record';
import type {
  GenerationInputSnapshot,
  GenerationRepository,
  GenerationRunRecord,
  NewGenerationRun,
  NewVersion,
  RunCompletion,
} from '../../src/generation/generation.repository';

interface StoredRun extends GenerationRunRecord {
  readonly inputSnapshot: GenerationInputSnapshot;
}

// Репозиторий запусков в памяти: та же семантика, что у DrizzleGenerationRepository.
export class InMemoryGenerationRepository implements GenerationRepository {
  readonly runs = new Map<string, StoredRun>();
  readonly versions: NewVersion[] = [];
  readonly versionNumbers = new Map<string, number>();
  readonly audit: AuditRecord[] = [];
  // Время запуска — настоящее: суточные лимиты считаются относительно текущих суток,
  // и фиксированная дата ломала бы тест после полуночи по Москве.
  readonly clock = new Date();

  async insertRun(run: NewGenerationRun): Promise<string> {
    const id = randomUUID();
    this.runs.set(id, {
      id,
      articleId: run.articleId,
      status: 'running',
      provider: run.provider,
      model: run.model,
      promptVersion: run.promptVersion,
      inputSnapshot: run.inputSnapshot,
      inputTokens: null,
      outputTokens: null,
      latencyMs: null,
      costUsd: null,
      errorCode: null,
      questions: [],
      idempotencyKey: run.idempotencyKey,
      createdBy: run.createdBy,
      createdAt: this.clock,
      finishedAt: null,
      versionNumber: null,
    });
    return id;
  }

  async findRun(id: string): Promise<GenerationRunRecord | undefined> {
    return this.runs.get(id);
  }

  async findRunByIdempotencyKey(key: string): Promise<GenerationRunRecord | undefined> {
    return [...this.runs.values()].find((run) => run.idempotencyKey === key);
  }

  async listRuns(articleId: string, limit: number): Promise<GenerationRunRecord[]> {
    return [...this.runs.values()]
      .filter((run) => run.articleId === articleId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, limit);
  }

  async completeRun(
    runId: string,
    completion: RunCompletion,
    version: NewVersion | null,
  ): Promise<number | null> {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Нет запуска ${runId}`);
    }
    this.runs.set(runId, {
      ...run,
      status: completion.status,
      inputTokens: completion.inputTokens,
      outputTokens: completion.outputTokens,
      latencyMs: completion.latencyMs,
      costUsd: completion.costUsd === null ? null : String(completion.costUsd),
      errorCode: completion.errorCode,
      questions: [...completion.questions],
      finishedAt: completion.finishedAt,
    });
    if (version === null) {
      return null;
    }
    const number = (this.versionNumbers.get(version.articleId) ?? 0) + 1;
    this.versionNumbers.set(version.articleId, number);
    this.versions.push(version);
    this.runs.set(runId, { ...(this.runs.get(runId) as StoredRun), versionNumber: number });
    return number;
  }

  async countRunsSince(userId: string, since: Date): Promise<number> {
    return [...this.runs.values()].filter(
      (run) => run.createdBy === userId && run.createdAt >= since,
    ).length;
  }

  async sumCostSince(since: Date): Promise<string> {
    const total = [...this.runs.values()]
      .filter((run) => run.createdAt >= since)
      .reduce((sum, run) => sum + Number(run.costUsd ?? 0), 0);
    return String(total);
  }

  async insertAudit(record: AuditRecord): Promise<void> {
    this.audit.push(record);
  }

  // Статус запуска для проверок: тесты смотрят, чем закончился прогон.
  statusOf(runId: string): GenerationStatus | undefined {
    return this.runs.get(runId)?.status;
  }
}
