import { Inject, Injectable } from '@nestjs/common';
import type { SearchResponse } from '@dzenwriter/shared';
import { SEARCH_REPOSITORY, type SearchRepository } from './search.repository';

const SEARCH_LIMIT_PER_TYPE = 5;
const MIN_QUERY_LENGTH = 2;

@Injectable()
export class SearchService {
  constructor(@Inject(SEARCH_REPOSITORY) private readonly repository: SearchRepository) {}

  async search(query: string): Promise<SearchResponse> {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      return { items: [] };
    }
    const items = await this.repository.search(trimmed, SEARCH_LIMIT_PER_TYPE);
    return { items };
  }
}
