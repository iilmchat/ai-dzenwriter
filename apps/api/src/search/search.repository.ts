import type { SearchResultItem } from '@dzenwriter/shared';

export const SEARCH_REPOSITORY = Symbol('SEARCH_REPOSITORY');

export interface SearchRepository {
  // Статьи, факты и продукты ищутся параллельно, по limit на каждый тип.
  search(query: string, limit: number): Promise<SearchResultItem[]>;
}
