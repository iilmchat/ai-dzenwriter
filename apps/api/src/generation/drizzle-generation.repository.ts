import { articleVersions, articles, generationRuns } from '@dzenwriter/db';
import type { GenerationStatus } from '@dzenwriter/shared';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { writeAuditRecord, type AuditRecord } from '../audit/audit.record';
import type { DbHandle } from '../database/db-handle';
import type {
  GenerationRepository,
  GenerationRunRecord,
  NewGenerationRun,
  NewVersion,
  RunCompletion,
} from './generation.repository';

interface RunSelectRow {
  id: string;
  articleId: string;
  status: string;
  provider: string;
  model: string;
  promptVersion: string;
  inputSnapshot: unknown;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  costUsd: string | null;
  errorCode: string | null;
  questions: unknown;
  idempotencyKey: string | null;
  createdBy: string;
  createdAt: Date;
  finishedAt: Date | null;
  versionNumber: number | null;
}

const runSelection = {
  id: generationRuns.id,
  articleId: generationRuns.articleId,
  status: generationRuns.status,
  provider: generationRuns.provider,
  model: generationRuns.model,
  promptVersion: generationRuns.promptVersion,
  inputSnapshot: generationRuns.inputSnapshot,
  inputTokens: generationRuns.inputTokens,
  outputTokens: generationRuns.outputTokens,
  latencyMs: generationRuns.latencyMs,
  costUsd: generationRuns.costUsd,
  errorCode: generationRuns.errorCode,
  questions: generationRuns.questions,
  idempotencyKey: generationRuns.idempotencyKey,
  createdBy: generationRuns.createdBy,
  createdAt: generationRuns.createdAt,
  finishedAt: generationRuns.finishedAt,
  versionNumber: articleVersions.number,
};

export class DrizzleGenerationRepository implements GenerationRepository {
  constructor(private readonly db: DbHandle) {}

  async insertRun(run: NewGenerationRun): Promise<string> {
    const [row] = await this.db
      .insert(generationRuns)
      .values({
        articleId: run.articleId,
        status: 'running',
        provider: run.provider,
        model: run.model,
        promptVersion: run.promptVersion,
        inputSnapshot: run.inputSnapshot,
        idempotencyKey: run.idempotencyKey,
        createdBy: run.createdBy,
      })
      .returning({ id: generationRuns.id });
    if (!row) {
      throw new Error('Запуск генерации не сохранился');
    }
    return row.id;
  }

  async findRun(id: string): Promise<GenerationRunRecord | undefined> {
    const rows = await this.db
      .select(runSelection)
      .from(generationRuns)
      .leftJoin(articleVersions, eq(articleVersions.generationRunId, generationRuns.id))
      .where(eq(generationRuns.id, id))
      .limit(1);
    const [row] = rows;
    return row ? toRunRecord(row) : undefined;
  }

  async findRunByIdempotencyKey(key: string): Promise<GenerationRunRecord | undefined> {
    const rows = await this.db
      .select(runSelection)
      .from(generationRuns)
      .leftJoin(articleVersions, eq(articleVersions.generationRunId, generationRuns.id))
      .where(eq(generationRuns.idempotencyKey, key))
      .limit(1);
    const [row] = rows;
    return row ? toRunRecord(row) : undefined;
  }

  async listRuns(articleId: string, limit: number): Promise<GenerationRunRecord[]> {
    const rows = await this.db
      .select(runSelection)
      .from(generationRuns)
      .leftJoin(articleVersions, eq(articleVersions.generationRunId, generationRuns.id))
      .where(eq(generationRuns.articleId, articleId))
      .orderBy(desc(generationRuns.createdAt))
      .limit(limit);
    return rows.map(toRunRecord);
  }

  async completeRun(
    runId: string,
    completion: RunCompletion,
    version: NewVersion | null,
  ): Promise<number | null> {
    return this.db.transaction(async (tx) => {
      await tx
        .update(generationRuns)
        .set({
          status: completion.status,
          inputTokens: completion.inputTokens,
          outputTokens: completion.outputTokens,
          latencyMs: completion.latencyMs,
          costUsd: completion.costUsd === null ? null : String(completion.costUsd),
          errorCode: completion.errorCode,
          questions: [...completion.questions],
          finishedAt: completion.finishedAt,
        })
        .where(eq(generationRuns.id, runId));

      if (version === null) {
        return null;
      }

      // Номер версии считаем под блокировкой материала: два запуска не получат один номер.
      await tx
        .select({ id: articles.id })
        .from(articles)
        .where(eq(articles.id, version.articleId))
        .for('update');
      const [counter] = await tx
        .select({ next: sql<number>`coalesce(max(${articleVersions.number}), 0)::int + 1` })
        .from(articleVersions)
        .where(eq(articleVersions.articleId, version.articleId));
      const number = counter?.next ?? 1;

      await tx.insert(articleVersions).values({
        articleId: version.articleId,
        number,
        origin: version.origin,
        title: version.title,
        articleMarkdown: version.articleMarkdown,
        seoTitle: version.seoTitle,
        tags: [...version.tags],
        description: version.description,
        imagePrompt: version.imagePrompt,
        advertisingLabel: version.advertisingLabel,
        disclaimerText: version.disclaimerText,
        claims: version.claims.map((claim) => ({
          text: claim.text,
          type: claim.type,
          factIds: claim.factIds,
        })),
        checks: version.checks.map((check) => ({
          id: check.id,
          severity: check.severity,
          ...(check.message === undefined ? {} : { message: check.message }),
        })),
        styleVersion: version.styleVersion,
        promptVersion: version.promptVersion,
        generationRunId: version.generationRunId,
        createdBy: version.createdBy,
      });

      // Материал изменился: поднимаем версию оптимистичной блокировки.
      await tx
        .update(articles)
        .set({
          currentVersionNumber: number,
          version: sql`${articles.version} + 1`,
          updatedAt: completion.finishedAt,
        })
        .where(eq(articles.id, version.articleId));

      return number;
    });
  }

  async countRunsSince(userId: string, since: Date): Promise<number> {
    const rows = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(generationRuns)
      .where(and(eq(generationRuns.createdBy, userId), gte(generationRuns.createdAt, since)));
    return rows[0]?.total ?? 0;
  }

  async sumCostSince(since: Date): Promise<string> {
    const rows = await this.db
      .select({ total: sql<string>`coalesce(sum(${generationRuns.costUsd}), 0)::text` })
      .from(generationRuns)
      .where(gte(generationRuns.createdAt, since));
    return rows[0]?.total ?? '0';
  }

  async insertAudit(record: AuditRecord): Promise<void> {
    await writeAuditRecord(this.db, record);
  }
}

function toRunRecord(row: RunSelectRow): GenerationRunRecord {
  return {
    id: row.id,
    articleId: row.articleId,
    status: row.status as GenerationStatus,
    provider: row.provider,
    model: row.model,
    promptVersion: row.promptVersion,
    inputSnapshot: row.inputSnapshot,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    latencyMs: row.latencyMs,
    costUsd: row.costUsd,
    errorCode: row.errorCode,
    questions: parseQuestions(row.questions),
    idempotencyKey: row.idempotencyKey,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
    versionNumber: row.versionNumber,
  };
}

// questions в БД — jsonb: битые записи не должны ронять чтение истории.
function parseQuestions(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((item): item is string => typeof item === 'string');
}
