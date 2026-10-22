import type { AuditRecord } from '../audit/audit.record';

export const CATALOG_REPOSITORY = Symbol('CATALOG_REPOSITORY');

export interface ProductRecord {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly oneLiner: string;
  readonly archived: boolean;
}

export interface NewProduct {
  readonly slug: string;
  readonly name: string;
  readonly oneLiner: string;
}

export interface ProductChanges {
  readonly slug?: string;
  readonly name?: string;
  readonly oneLiner?: string;
  readonly archivedAt?: Date | null;
}

// Справочники из БД. Стили и форматы читаются из config/, поэтому здесь только продукты.
export interface CatalogRepository {
  // Правка продукта и запись в аудит идут одной транзакцией.
  withTransaction<T>(work: (repository: CatalogRepository) => Promise<T>): Promise<T>;
  listProducts(): Promise<ProductRecord[]>;
  findProduct(id: string): Promise<ProductRecord | undefined>;
  findProductBySlug(slug: string): Promise<ProductRecord | undefined>;
  insertProduct(product: NewProduct): Promise<string>;
  updateProduct(id: string, changes: ProductChanges): Promise<void>;
  insertAudit(record: AuditRecord): Promise<void>;
}
