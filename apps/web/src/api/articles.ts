import {
  articleDetailSchema,
  articleListResponseSchema,
  createArticleResponseSchema,
  draftSchema,
  type ArticleDetail,
  type ArticleDraft,
  type ArticleListResponse,
  type CreateArticleInput,
  type CreateArticleResponse,
  type GenerateBriefResponse,
  generateBriefResponseSchema,
  type RegenerateFragmentInput,
  type RegenerateFragmentResponse,
  regenerateFragmentResponseSchema,
  type SaveDraftInput,
  type TitleOptionsResponse,
  titleOptionsResponseSchema,
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

// Серверный черновик: автосохранение правки без создания версии.
export function saveDraft(articleId: string, body: SaveDraftInput): Promise<ArticleDraft> {
  return apiRequest(`/api/v1/articles/${articleId}/draft`, {
    method: 'PATCH',
    body,
    schema: draftSchema,
  });
}

// Генерация брифа (плана) статьи до генерации текста.
export function generateBrief(articleId: string): Promise<GenerateBriefResponse> {
  return apiRequest(`/api/v1/articles/${articleId}/brief`, {
    method: 'POST',
    schema: generateBriefResponseSchema,
  });
}

// Локальная правка выделенного фрагмента: версия статьи не создаётся.
export function regenerateFragment(
  articleId: string,
  body: RegenerateFragmentInput,
): Promise<RegenerateFragmentResponse> {
  return apiRequest(`/api/v1/articles/${articleId}/generations/fragment`, {
    method: 'POST',
    body,
    schema: regenerateFragmentResponseSchema,
  });
}

// Варианты заголовка по теме, текущему заголовку и брифу.
export function generateTitleOptions(articleId: string): Promise<TitleOptionsResponse> {
  return apiRequest(`/api/v1/articles/${articleId}/generations/titles`, {
    method: 'POST',
    schema: titleOptionsResponseSchema,
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

// Подтверждение проверки автором: снимает блокировку и попадает в аудит.
export function confirmCheck(
  articleId: string,
  versionNumber: number,
  checkIndex: number,
  comment: string,
): Promise<ArticleDetail> {
  return apiRequest(
    `/api/v1/articles/${articleId}/versions/${versionNumber}/checks/${checkIndex}/confirm`,
    {
      method: 'POST',
      body: { comment },
      schema: articleDetailSchema,
    },
  );
}
