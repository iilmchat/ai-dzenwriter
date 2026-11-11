import { articleDrafts, articleVersions, articles } from '@dzenwriter/db';
import type { VersionClaim, VersionCheck, VersionOrigin } from '@dzenwriter/shared';
import { eq, sql } from 'drizzle-orm';
import type { DbHandle } from '../database/db-handle';

export interface NewVersionRecord {
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
  readonly claims: readonly VersionClaim[];
  readonly checks: readonly VersionCheck[];
  readonly styleVersion: number;
  readonly promptVersion: string;
  readonly generationRunId: string | null;
  readonly createdBy: string;
}

// Версия пишется под блокировкой материала: два сохранения не получают один номер.
// Версия неизменяема, поэтому любое изменение состояния — новая версия.
export async function insertVersion(
  db: DbHandle,
  version: NewVersionRecord,
  now: Date,
): Promise<number> {
  await db
    .select({ id: articles.id })
    .from(articles)
    .where(eq(articles.id, version.articleId))
    .for('update');

  const [counter] = await db
    .select({ next: sql<number>`coalesce(max(${articleVersions.number}), 0)::int + 1` })
    .from(articleVersions)
    .where(eq(articleVersions.articleId, version.articleId));
  const number = counter?.next ?? 1;

  await db.insert(articleVersions).values({
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
      ...(claim.start === undefined ? {} : { start: claim.start }),
      ...(claim.end === undefined ? {} : { end: claim.end }),
    })),
    checks: version.checks.map((check) => ({
      id: check.id,
      severity: check.severity,
      message: check.message,
      ...(check.start === undefined ? {} : { start: check.start }),
      ...(check.end === undefined ? {} : { end: check.end }),
      ...(check.excerpt === undefined ? {} : { excerpt: check.excerpt }),
      ...(check.decision === undefined ? {} : { decision: check.decision }),
      ...(check.comment === undefined ? {} : { comment: check.comment }),
      ...(check.confirmedBy === undefined ? {} : { confirmedBy: check.confirmedBy }),
      ...(check.confirmedAt === undefined ? {} : { confirmedAt: check.confirmedAt }),
    })),
    styleVersion: version.styleVersion,
    promptVersion: version.promptVersion,
    generationRunId: version.generationRunId,
    createdBy: version.createdBy,
  });

  // Материал изменился: поднимаем версию оптимистичной блокировки.
  await db
    .update(articles)
    .set({
      currentVersionNumber: number,
      version: sql`${articles.version} + 1`,
      updatedAt: now,
    })
    .where(eq(articles.id, version.articleId));

  // Правки зафиксированы версией: серверный черновик больше не нужен.
  await db.delete(articleDrafts).where(eq(articleDrafts.articleId, version.articleId));

  return number;
}
