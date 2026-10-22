import { randomUUID } from 'node:crypto';
import type { AuditRecord } from '../../src/audit/audit.record';
import type {
  CatalogRepository,
  NewProduct,
  ProductChanges,
  ProductRecord,
} from '../../src/catalog/catalog.repository';

export class InMemoryCatalog implements CatalogRepository {
  readonly products: ProductRecord[] = [];
  readonly audit: AuditRecord[] = [];

  async withTransaction<T>(work: (repository: CatalogRepository) => Promise<T>): Promise<T> {
    return work(this);
  }

  async listProducts(): Promise<ProductRecord[]> {
    return [...this.products];
  }

  async findProduct(id: string): Promise<ProductRecord | undefined> {
    return this.products.find((product) => product.id === id);
  }

  async findProductBySlug(slug: string): Promise<ProductRecord | undefined> {
    return this.products.find((product) => product.slug === slug);
  }

  async insertProduct(product: NewProduct): Promise<string> {
    const id = randomUUID();
    this.products.push({ id, ...product, archived: false });
    return id;
  }

  async updateProduct(id: string, changes: ProductChanges): Promise<void> {
    const index = this.products.findIndex((product) => product.id === id);
    const current = this.products[index];
    if (!current) {
      throw new Error(`Нет продукта ${id}`);
    }
    this.products[index] = {
      ...current,
      slug: changes.slug ?? current.slug,
      name: changes.name ?? current.name,
      oneLiner: changes.oneLiner ?? current.oneLiner,
      archived: changes.archivedAt === undefined ? current.archived : changes.archivedAt !== null,
    };
  }

  async insertAudit(record: AuditRecord): Promise<void> {
    this.audit.push(record);
  }
}
