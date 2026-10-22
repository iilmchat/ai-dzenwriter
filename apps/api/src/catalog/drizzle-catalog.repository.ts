import { products } from '@dzenwriter/db';
import { asc, eq } from 'drizzle-orm';
import { writeAuditRecord, type AuditRecord } from '../audit/audit.record';
import type { DbHandle } from '../database/db-handle';
import type {
  CatalogRepository,
  NewProduct,
  ProductChanges,
  ProductRecord,
} from './catalog.repository';

export class DrizzleCatalogRepository implements CatalogRepository {
  constructor(private readonly db: DbHandle) {}

  withTransaction<T>(work: (repository: CatalogRepository) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(new DrizzleCatalogRepository(tx)));
  }

  async listProducts(): Promise<ProductRecord[]> {
    const rows = await this.db.select().from(products).orderBy(asc(products.name));
    return rows.map(toProductRecord);
  }

  async findProduct(id: string): Promise<ProductRecord | undefined> {
    const [row] = await this.db.select().from(products).where(eq(products.id, id)).limit(1);
    return row ? toProductRecord(row) : undefined;
  }

  async findProductBySlug(slug: string): Promise<ProductRecord | undefined> {
    const [row] = await this.db.select().from(products).where(eq(products.slug, slug)).limit(1);
    return row ? toProductRecord(row) : undefined;
  }

  async insertProduct(product: NewProduct): Promise<string> {
    const [row] = await this.db
      .insert(products)
      .values({ slug: product.slug, name: product.name, oneLiner: product.oneLiner })
      .returning({ id: products.id });
    if (!row) {
      throw new Error('Продукт не сохранился');
    }
    return row.id;
  }

  async updateProduct(id: string, changes: ProductChanges): Promise<void> {
    await this.db
      .update(products)
      .set({
        slug: changes.slug,
        name: changes.name,
        oneLiner: changes.oneLiner,
        archivedAt: changes.archivedAt,
      })
      .where(eq(products.id, id));
  }

  async insertAudit(record: AuditRecord): Promise<void> {
    await writeAuditRecord(this.db, record);
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
