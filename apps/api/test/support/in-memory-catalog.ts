import type { CatalogRepository, ProductRecord } from '../../src/catalog/catalog.repository';

export class InMemoryCatalog implements CatalogRepository {
  readonly products: ProductRecord[] = [];

  async listProducts(): Promise<ProductRecord[]> {
    return [...this.products];
  }

  async findProduct(id: string): Promise<ProductRecord | undefined> {
    return this.products.find((product) => product.id === id);
  }
}
