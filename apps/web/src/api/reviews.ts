import {
  type CreateReviewCommentInput,
  type ReviewComment,
  reviewCommentSchema,
  type ReviewCommentsResponse,
  reviewCommentsResponseSchema,
} from '@dzenwriter/shared';
import { apiRequest } from './client';

export function fetchReviewComments(
  articleId: string,
  versionNumber: number,
): Promise<ReviewCommentsResponse> {
  return apiRequest(`/api/v1/articles/${articleId}/versions/${versionNumber}/comments`, {
    schema: reviewCommentsResponseSchema,
  });
}

export function createReviewComment(
  articleId: string,
  versionNumber: number,
  input: CreateReviewCommentInput,
): Promise<ReviewComment> {
  return apiRequest(`/api/v1/articles/${articleId}/versions/${versionNumber}/comments`, {
    method: 'POST',
    body: input,
    schema: reviewCommentSchema,
  });
}

export function resolveReviewComment(
  articleId: string,
  versionNumber: number,
  commentId: string,
): Promise<ReviewCommentsResponse> {
  return apiRequest(
    `/api/v1/articles/${articleId}/versions/${versionNumber}/comments/${commentId}/resolve`,
    {
      method: 'PATCH',
      schema: reviewCommentsResponseSchema,
    },
  );
}
