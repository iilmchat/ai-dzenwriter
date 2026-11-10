import type { SearchResultItem } from '@dzenwriter/shared';
import type { SearchRepository } from '../../src/search/search.repository';

export interface SearchSeed {
  readonly articles: readonly { readonly id: string; readonly title: string }[];
  readonly facts: readonly { readonly id: string; readonly title: string }[];
  readonly products: readonly {
    readonly id: string;
    readonly title: string;
    readonly oneLiner: string;
  }[];
}

// Поиск в памяти: та же выдача и URL, что у DrizzleSearchRepository.
export class InMemorySearchRepository implements SearchRepository {
  readonly queries: string[] = [];

  constructor(private readonly seed: SearchSeed) {}

  async search(query: string, limit: number): Promise<SearchResultItem[]> {
    this.queries.push(query);
    const needle = query.toLowerCase();
    const includes = (value: string): boolean => value.toLowerCase().includes(needle);

    return [
      ...this.seed.articles
        .filter((item) => includes(item.title))
        .slice(0, limit)
        .map((item) => ({
          type: 'article' as const,
          id: item.id,
          title: item.title,
          subtitle: 'Статья',
          url: `/articles/${item.id}`,
        })),
      ...this.seed.facts
        .filter((item) => includes(item.title))
        .slice(0, limit)
        .map((item) => ({
          type: 'fact' as const,
          id: item.id,
          title: item.title,
          subtitle: 'Факт',
          url: '/facts',
        })),
      ...this.seed.products
        .filter((item) => includes(item.title) || includes(item.oneLiner))
        .slice(0, limit)
        .map((item) => ({
          type: 'product' as const,
          id: item.id,
          title: item.title,
          subtitle: item.oneLiner,
          url: '/products',
        })),
    ];
  }
}
