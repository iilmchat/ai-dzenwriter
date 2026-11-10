import { randomUUID } from 'node:crypto';
import type { AuditRecord } from '../../src/audit/audit.record';
import type {
  NewReviewComment,
  ReviewCommentRow,
  ReviewsRepository,
} from '../../src/reviews/reviews.repository';

// Репозиторий комментариев в памяти: та же семантика, что у Drizzle-репозитория.
export class InMemoryReviewsRepository implements ReviewsRepository {
  readonly rows: ReviewCommentRow[] = [];
  readonly audit: AuditRecord[] = [];
  readonly clock = new Date('2026-10-22T10:00:00Z');

  constructor(private readonly reviewerNames: ReadonlyMap<string, string> = new Map()) {}

  async createComment(input: NewReviewComment): Promise<ReviewCommentRow> {
    const row: ReviewCommentRow = {
      id: randomUUID(),
      articleId: input.articleId,
      versionNumber: input.versionNumber,
      reviewerId: input.reviewerId,
      reviewerName: this.reviewerNames.get(input.reviewerId) ?? input.reviewerId,
      comment: input.comment,
      selectedText: input.selectedText,
      startOffset: input.startOffset,
      endOffset: input.endOffset,
      isResolved: false,
      createdAt: new Date(this.clock.getTime() + this.rows.length),
    };
    this.rows.push(row);
    return row;
  }

  async listComments(articleId: string, versionNumber: number): Promise<ReviewCommentRow[]> {
    return this.rows
      .filter((row) => row.articleId === articleId && row.versionNumber === versionNumber)
      .sort(
        (left, right) =>
          Number(left.isResolved) - Number(right.isResolved) ||
          left.createdAt.getTime() - right.createdAt.getTime(),
      );
  }

  async findComment(id: string): Promise<ReviewCommentRow | undefined> {
    return this.rows.find((row) => row.id === id);
  }

  async resolveComment(id: string): Promise<ReviewCommentRow | undefined> {
    const index = this.rows.findIndex((row) => row.id === id);
    const row = this.rows[index];
    if (row === undefined) {
      return undefined;
    }
    const resolved = { ...row, isResolved: true };
    this.rows[index] = resolved;
    return resolved;
  }

  async insertAudit(record: AuditRecord): Promise<void> {
    this.audit.push(record);
  }
}
