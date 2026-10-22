import { products } from '@dzenwriter/db';
import { asc, eq } from 'drizzle-orm';
import type { DbHandle } from '../database/db-handle';
import type { CatalogRepository, ProductRecord } from './catalog.repository';

export class DrizzleCatalogRepository implements CatalogRepository {
  constructor(private readonly db: DbHandle) {}

  async listProducts(): Promise<ProductRecord[]> {
    const rows = await this.db.select().from(products).orderBy(asc(products.name));
    return rows.map(toProductRecord);
  }

  async findProduct(id: string): Promise<ProductRecord | undefined> {
    const [row] = await this.db.select().from(products).where(eq(products.id, id)).limit(1);
    return row ? toProductRecord(row) : undefined;
  }
}

function toProductRecord(row: typeof products.$inferSelect): ProductRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    oneLiner: row.oneLiner,
    archived: row.archivedAt !== null,
  };
}
