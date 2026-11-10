import type { AuditRecord } from '../audit/audit.record';

export const REVIEWS_REPOSITORY = Symbol('REVIEWS_REPOSITORY');

export interface ReviewCommentRow {
  readonly id: string;
  readonly articleId: string;
  readonly versionNumber: number;
  readonly reviewerId: string;
  readonly reviewerName: string;
  readonly comment: string;
  readonly selectedText: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly isResolved: boolean;
  readonly createdAt: Date;
}

export interface NewReviewComment {
  readonly articleId: string;
  readonly versionNumber: number;
  readonly reviewerId: string;
  readonly comment: string;
  readonly selectedText: string;
  readonly startOffset: number;
  readonly endOffset: number;
}

export interface ReviewsRepository {
  createComment(input: NewReviewComment): Promise<ReviewCommentRow>;
  listComments(articleId: string, versionNumber: number): Promise<ReviewCommentRow[]>;
  findComment(id: string): Promise<ReviewCommentRow | undefined>;
  // Обновляет комментарий и возвращает его после изменения.
  resolveComment(id: string): Promise<ReviewCommentRow | undefined>;
  insertAudit(record: AuditRecord): Promise<void>;
}
