import { reviewComments, users } from '@dzenwriter/db';
import { and, asc, eq } from 'drizzle-orm';
import { writeAuditRecord, type AuditRecord } from '../audit/audit.record';
import type { DbHandle } from '../database/db-handle';
import type { NewReviewComment, ReviewCommentRow, ReviewsRepository } from './reviews.repository';

const selection = {
  id: reviewComments.id,
  articleId: reviewComments.articleId,
  versionNumber: reviewComments.versionNumber,
  reviewerId: reviewComments.reviewerId,
  reviewerName: users.name,
  reviewerLogin: users.login,
  comment: reviewComments.comment,
  selectedText: reviewComments.selectedText,
  startOffset: reviewComments.startOffset,
  endOffset: reviewComments.endOffset,
  isResolved: reviewComments.isResolved,
  createdAt: reviewComments.createdAt,
};

export class DrizzleReviewsRepository implements ReviewsRepository {
  constructor(private readonly db: DbHandle) {}

  async createComment(input: NewReviewComment): Promise<ReviewCommentRow> {
    const [inserted] = await this.db
      .insert(reviewComments)
      .values({
        articleId: input.articleId,
        versionNumber: input.versionNumber,
        reviewerId: input.reviewerId,
        comment: input.comment,
        selectedText: input.selectedText,
        startOffset: input.startOffset,
        endOffset: input.endOffset,
      })
      .returning({ id: reviewComments.id });
    if (!inserted) {
      throw new Error('Комментарий не сохранился');
    }
    const created = await this.findComment(inserted.id);
    if (!created) {
      throw new Error('Комментарий не найден после сохранения');
    }
    return created;
  }

  async listComments(articleId: string, versionNumber: number): Promise<ReviewCommentRow[]> {
    const rows = await this.db
      .select(selection)
      .from(reviewComments)
      .innerJoin(users, eq(users.id, reviewComments.reviewerId))
      .where(
        and(
          eq(reviewComments.articleId, articleId),
          eq(reviewComments.versionNumber, versionNumber),
        ),
      )
      .orderBy(asc(reviewComments.isResolved), asc(reviewComments.createdAt));
    return rows.map(toRow);
  }

  async findComment(id: string): Promise<ReviewCommentRow | undefined> {
    const rows = await this.db
      .select(selection)
      .from(reviewComments)
      .innerJoin(users, eq(users.id, reviewComments.reviewerId))
      .where(eq(reviewComments.id, id))
      .limit(1);
    const [row] = rows;
    return row ? toRow(row) : undefined;
  }

  async resolveComment(id: string): Promise<ReviewCommentRow | undefined> {
    const rows = await this.db
      .update(reviewComments)
      .set({ isResolved: true })
      .where(eq(reviewComments.id, id))
      .returning({ id: reviewComments.id });
    const [updated] = rows;
    return updated ? this.findComment(updated.id) : undefined;
  }

  async insertAudit(record: AuditRecord): Promise<void> {
    await writeAuditRecord(this.db, record);
  }
}

function toRow(row: {
  readonly id: string;
  readonly articleId: string;
  readonly versionNumber: number;
  readonly reviewerId: string;
  readonly reviewerName: string | null;
  readonly reviewerLogin: string;
  readonly comment: string;
  readonly selectedText: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly isResolved: boolean;
  readonly createdAt: Date;
}): ReviewCommentRow {
  return {
    id: row.id,
    articleId: row.articleId,
    versionNumber: row.versionNumber,
    reviewerId: row.reviewerId,
    reviewerName: row.reviewerName ?? row.reviewerLogin,
    comment: row.comment,
    selectedText: row.selectedText,
    startOffset: row.startOffset,
    endOffset: row.endOffset,
    isResolved: row.isResolved,
    createdAt: row.createdAt,
  };
}
