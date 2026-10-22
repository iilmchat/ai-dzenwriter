import {
  articleDetailSchema,
  articleListResponseSchema,
  createArticleResponseSchema,
  type ArticleDetail,
  type ArticleListResponse,
  type CreateArticleInput,
  type CreateArticleResponse,
  type TransitionInput,
  type UpdateArticleInput,
} from '@dzenwriter/shared';
import { endOfDayIso, startOfDayIso } from '../lib/format';
import { apiRequest } from './client';

export interface BoardFilters {
  readonly styleId: string;
  readonly mine: boolean;
  readonly plannedFrom: string;
  readonly plannedTo: string;
  readonly includeArchived: boolean;
}

export function fetchArticles(filters: BoardFilters): Promise<ArticleListResponse> {
  const params = new URLSearchParams();
  if (filters.styleId) {
    params.set('styleId', filters.styleId);
  }
  if (filters.mine) {
    params.set('mine', 'true');
  }
  if (filters.includeArchived) {
    params.set('includeArchived', 'true');
  }
  if (filters.plannedFrom) {
    params.set('plannedFrom', startOfDayIso(filters.plannedFrom));
  }
  if (filters.plannedTo) {
    params.set('plannedTo', endOfDayIso(filters.plannedTo));
  }
  const query = params.toString();
  return apiRequest(`/api/v1/articles${query ? `?${query}` : ''}`, {
    schema: articleListResponseSchema,
  });
}

export function fetchArticle(id: string): Promise<ArticleDetail> {
  return apiRequest(`/api/v1/articles/${id}`, { schema: articleDetailSchema });
}

export function createArticle(input: CreateArticleInput): Promise<CreateArticleResponse> {
  return apiRequest('/api/v1/articles', {
    method: 'POST',
    body: input,
    schema: createArticleResponseSchema,
  });
}

export function updateArticle(id: string, input: UpdateArticleInput): Promise<ArticleDetail> {
  return apiRequest(`/api/v1/articles/${id}`, {
    method: 'PATCH',
    body: input,
    schema: articleDetailSchema,
  });
}

export function transitionArticle(id: string, input: TransitionInput): Promise<ArticleDetail> {
  return apiRequest(`/api/v1/articles/${id}/transitions`, {
    method: 'POST',
    body: input,
    schema: articleDetailSchema,
  });
}

export function attachFact(articleId: string, factId: string): Promise<ArticleDetail> {
  return apiRequest(`/api/v1/articles/${articleId}/facts`, {
    method: 'POST',
    body: { factId },
    schema: articleDetailSchema,
  });
}

export function detachFact(articleId: string, factId: string): Promise<ArticleDetail> {
  return apiRequest(`/api/v1/articles/${articleId}/facts/${factId}`, {
    method: 'DELETE',
    schema: articleDetailSchema,
  });
}

// Подтверждение ревьюера на запуск генерации для темы вне фокуса ИИ.
export function confirmGeneration(articleId: string): Promise<ArticleDetail> {
  return apiRequest(`/api/v1/articles/${articleId}/generation-confirmation`, {
    method: 'POST',
    schema: articleDetailSchema,
  });
}
