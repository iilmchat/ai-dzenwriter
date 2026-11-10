import { searchResponseSchema, type SearchResponse } from '@dzenwriter/shared';
import { apiRequest } from './client';

export function fetchSearch(query: string): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query });
  return apiRequest(`/api/v1/search?${params.toString()}`, {
    schema: searchResponseSchema,
  });
}
