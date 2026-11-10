import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateReviewCommentInput,
  ReviewComment,
  ReviewCommentsResponse,
  UserRole,
} from '@dzenwriter/shared';
import { ARTICLES_REPOSITORY, type ArticlesRepository } from '../articles/articles.repository';
import {
  REVIEWS_REPOSITORY,
  type ReviewCommentRow,
  type ReviewsRepository,
} from './reviews.repository';

export interface ReviewActor {
  readonly id: string;
  readonly role: UserRole;
}

@Injectable()
export class ReviewsService {
  constructor(
    @Inject(REVIEWS_REPOSITORY) private readonly repository: ReviewsRepository,
    @Inject(ARTICLES_REPOSITORY) private readonly articles: ArticlesRepository,
  ) {}

  async createComment(
    actor: ReviewActor,
    articleId: string,
    input: CreateReviewCommentInput,
  ): Promise<ReviewComment> {
    if (actor.role !== 'reviewer' && actor.role !== 'admin') {
      throw new ForbiddenException(
        'Комментировать фрагменты может только ревьюер или администратор',
      );
    }
    const article = await this.articles.findArticle(articleId);
    if (!article) {
      throw new NotFoundException('Материал не найден');
    }
    const version = await this.articles.findVersion(articleId, input.versionNumber);
    if (!version) {
      throw new NotFoundException('Версия не найдена');
    }

    const row = await this.repository.createComment({
      articleId,
      versionNumber: input.versionNumber,
      reviewerId: actor.id,
      comment: input.comment,
      selectedText: input.selectedText,
      startOffset: input.startOffset,
      endOffset: input.endOffset,
    });
    await this.repository.insertAudit({
      actorId: actor.id,
      action: 'review.comment_create',
      entityType: 'article',
      entityId: articleId,
      payload: {
        commentId: row.id,
        versionNumber: row.versionNumber,
        startOffset: row.startOffset,
        endOffset: row.endOffset,
      },
    });
    return toComment(row);
  }

  // Комментарии видят все вошедшие: обсуждение фрагмента открыто команде.
  async listComments(
    actor: ReviewActor,
    articleId: string,
    versionNumber: number,
  ): Promise<ReviewCommentsResponse> {
    void actor;
    const article = await this.articles.findArticle(articleId);
    if (!article) {
      throw new NotFoundException('Материал не найден');
    }
    const rows = await this.repository.listComments(articleId, versionNumber);
    return { items: rows.map(toComment) };
  }

  async resolveComment(
    actor: ReviewActor,
    articleId: string,
    versionNumber: number,
    commentId: string,
  ): Promise<ReviewCommentsResponse> {
    const article = await this.articles.findArticle(articleId);
    if (!article) {
      throw new NotFoundException('Материал не найден');
    }
    const comment = await this.repository.findComment(commentId);
    if (!comment || comment.articleId !== articleId || comment.versionNumber !== versionNumber) {
      throw new NotFoundException('Комментарий не найден');
    }
    const allowed =
      actor.role === 'admin' ||
      actor.role === 'reviewer' ||
      actor.id === article.ownerId ||
      actor.id === comment.reviewerId;
    if (!allowed) {
      throw new ForbiddenException('Отметить комментарий может автор материала или ревьюер');
    }

    if (!comment.isResolved) {
      const resolved = await this.repository.resolveComment(commentId);
      if (!resolved) {
        throw new NotFoundException('Комментарий не найден');
      }
      await this.repository.insertAudit({
        actorId: actor.id,
        action: 'review.comment_resolve',
        entityType: 'article',
        entityId: articleId,
        payload: { commentId, versionNumber },
      });
    }
    const rows = await this.repository.listComments(articleId, versionNumber);
    return { items: rows.map(toComment) };
  }
}

function toComment(row: ReviewCommentRow): ReviewComment {
  return {
    id: row.id,
    reviewerName: row.reviewerName,
    comment: row.comment,
    selectedText: row.selectedText,
    startOffset: row.startOffset,
    endOffset: row.endOffset,
    isResolved: row.isResolved,
    createdAt: row.createdAt.toISOString(),
  };
}
