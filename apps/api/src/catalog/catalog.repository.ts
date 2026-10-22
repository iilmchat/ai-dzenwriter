export const CATALOG_REPOSITORY = Symbol('CATALOG_REPOSITORY');

export interface ProductRecord {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly oneLiner: string;
  readonly archived: boolean;
}

// Справочники из БД. Стили и форматы читаются из config/, поэтому здесь только продукты.
export interface CatalogRepository {
  listProducts(): Promise<ProductRecord[]>;
  findProduct(id: string): Promise<ProductRecord | undefined>;
}
