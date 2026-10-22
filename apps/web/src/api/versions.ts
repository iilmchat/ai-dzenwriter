import {
  checkVersionResponseSchema,
  saveVersionResponseSchema,
  versionDetailSchema,
  versionListResponseSchema,
  type CheckVersionInput,
  type CheckVersionResponse,
  type SaveVersionInput,
  type SaveVersionResponse,
  type VersionDetail,
  type VersionListResponse,
} from '@dzenwriter/shared';
import { apiRequest } from './client';

export function fetchVersions(articleId: string): Promise<VersionListResponse> {
  return apiRequest(`/api/v1/articles/${articleId}/versions`, {
    schema: versionListResponseSchema,
  });
}

export function fetchVersion(articleId: string, number: number): Promise<VersionDetail> {
  return apiRequest(`/api/v1/articles/${articleId}/versions/${number}`, {
    schema: versionDetailSchema,
  });
}

// Сохранение версии: проверки считает сервер, поэтому ответ приходит с ними.
export function saveVersion(
  articleId: string,
  input: SaveVersionInput,
): Promise<SaveVersionResponse> {
  return apiRequest(`/api/v1/articles/${articleId}/versions`, {
    method: 'POST',
    body: input,
    schema: saveVersionResponseSchema,
  });
}

// Откат: сервер создаёт новую версию с текстом старой.
export function rollbackVersion(articleId: string, number: number): Promise<SaveVersionResponse> {
  return apiRequest(`/api/v1/articles/${articleId}/versions/${number}/rollback`, {
    method: 'POST',
    schema: saveVersionResponseSchema,
  });
}

// Пробный прогон проверок: текст проверяется, версия не создаётся.
export function checkVersion(
  articleId: string,
  input: CheckVersionInput,
): Promise<CheckVersionResponse> {
  return apiRequest(`/api/v1/articles/${articleId}/versions/check`, {
    method: 'POST',
    body: input,
    schema: checkVersionResponseSchema,
  });
}
