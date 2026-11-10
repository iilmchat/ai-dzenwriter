import { articles, facts, products } from '@dzenwriter/db';
import type { SearchResultItem } from '@dzenwriter/shared';
import { and, ilike, isNull, or } from 'drizzle-orm';
import type { DbHandle } from '../database/db-handle';
import type { SearchRepository } from './search.repository';

export class DrizzleSearchRepository implements SearchRepository {
  constructor(private readonly db: DbHandle) {}

  async search(query: string, limit: number): Promise<SearchResultItem[]> {
    const pattern = `%${query}%`;

    const [articleRows, factRows, productRows] = await Promise.all([
      this.db
        .select({ id: articles.id, title: articles.topic })
        .from(articles)
        .where(
          and(
            or(ilike(articles.topic, pattern), ilike(articles.title, pattern)),
            isNull(articles.archivedAt),
          ),
        )
        .limit(limit),
      this.db
        .select({ id: facts.id, title: facts.text })
        .from(facts)
        .where(ilike(facts.text, pattern))
        .limit(limit),
      this.db
        .select({ id: products.id, title: products.name, oneLiner: products.oneLiner })
        .from(products)
        .where(
          and(
            or(ilike(products.name, pattern), ilike(products.oneLiner, pattern)),
            isNull(products.archivedAt),
          ),
        )
        .limit(limit),
    ]);

    return [
      ...articleRows.map((row) => ({
        type: 'article' as const,
        id: row.id,
        title: row.title,
        subtitle: 'Статья',
        url: `/articles/${row.id}`,
      })),
      ...factRows.map((row) => ({
        type: 'fact' as const,
        id: row.id,
        title: row.title,
        subtitle: 'Факт',
        url: '/facts',
      })),
      ...productRows.map((row) => ({
        type: 'product' as const,
        id: row.id,
        title: row.title,
        subtitle: row.oneLiner,
        url: '/products',
      })),
    ];
  }
}
