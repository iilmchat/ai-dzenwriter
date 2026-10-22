import { publicationListResponseSchema, type PublicationListResponse } from '@dzenwriter/shared';
import { apiRequest } from './client';

export function fetchPublications(): Promise<PublicationListResponse> {
  return apiRequest('/api/v1/publications', {
    schema: publicationListResponseSchema,
  });
}

// Ссылка на скачивание пакета: браузер отдаёт zip как вложение.
export function exportUrl(articleId: string): string {
  return `/api/v1/publications/${articleId}/export`;
}
