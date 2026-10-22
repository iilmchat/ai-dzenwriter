import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateProductInput, UpdateProductInput } from '@dzenwriter/shared';
import type { SessionUser } from '../auth/auth.service';
import {
  CATALOG_REPOSITORY,
  type CatalogRepository,
  type ProductChanges,
  type ProductRecord,
} from './catalog.repository';

const SLUG_TAKEN = 'Продукт с таким идентификатором уже есть';

// Справочник ведёт администратор. Продукт не удаляется: его архивируют, и ссылки материалов сохраняются.
@Injectable()
export class ProductsService {
  constructor(@Inject(CATALOG_REPOSITORY) private readonly catalog: CatalogRepository) {}

  async create(actor: SessionUser, input: CreateProductInput): Promise<ProductRecord> {
    if (await this.catalog.findProductBySlug(input.slug)) {
      throw new ConflictException(SLUG_TAKEN);
    }
    const id = await this.catalog.withTransaction(async (tx) => {
      const created = await tx.insertProduct(input);
      await tx.insertAudit({
        actorId: actor.id,
        action: 'product.create',
        entityType: 'product',
        entityId: created,
        payload: { slug: input.slug },
      });
      return created;
    });
    return this.require(id);
  }

  async update(
    actor: SessionUser,
    id: string,
    input: UpdateProductInput,
    now: Date,
  ): Promise<ProductRecord> {
    const current = await this.require(id);
    if (input.slug !== undefined && input.slug !== current.slug) {
      if (await this.catalog.findProductBySlug(input.slug)) {
        throw new ConflictException(SLUG_TAKEN);
      }
    }

    let archivedAt: Date | null | undefined;
    if (input.archived !== undefined && input.archived !== current.archived) {
      archivedAt = input.archived ? now : null;
    }
    const changedFields = (['slug', 'name', 'oneLiner'] as const).filter(
      (key) => input[key] !== undefined && input[key] !== current[key],
    );
    if (changedFields.length === 0 && archivedAt === undefined) {
      return current;
    }

    const changes: ProductChanges = {
      slug: input.slug,
      name: input.name,
      oneLiner: input.oneLiner,
      archivedAt,
    };
    await this.catalog.withTransaction(async (tx) => {
      await tx.updateProduct(id, changes);
      if (changedFields.length > 0) {
        await tx.insertAudit({
          actorId: actor.id,
          action: 'product.update',
          entityType: 'product',
          entityId: id,
          payload: { fields: changedFields },
        });
      }
      if (archivedAt !== undefined) {
        await tx.insertAudit({
          actorId: actor.id,
          action: archivedAt === null ? 'product.restore' : 'product.archive',
          entityType: 'product',
          entityId: id,
          payload: {},
        });
      }
    });
    return this.require(id);
  }

  private async require(id: string): Promise<ProductRecord> {
    const product = await this.catalog.findProduct(id);
    if (!product) {
      throw new NotFoundException('Продукт не найден');
    }
    return product;
  }
}
