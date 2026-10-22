import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { SessionUser } from '../src/auth/auth.service';
import { ProductsService } from '../src/catalog/products.service';
import { InMemoryCatalog } from './support/in-memory-catalog';

const NOW = new Date('2026-10-22T10:00:00Z');
const ADMIN: SessionUser = {
  id: '00000000-0000-4000-8000-0000000000ad',
  login: 'chief',
  name: null,
  role: 'admin',
  sessionId: 'session-admin',
};

function setup() {
  const catalog = new InMemoryCatalog();
  const service = new ProductsService(catalog);
  return { catalog, service };
}

describe('справочник продуктов', () => {
  it('создаёт продукт и пишет аудит', async () => {
    const { catalog, service } = setup();

    const product = await service.create(ADMIN, {
      slug: 'demo-product',
      name: 'Демо-продукт',
      oneLiner: 'Пример',
    });

    expect(product).toMatchObject({ slug: 'demo-product', archived: false });
    expect(catalog.audit).toEqual([
      expect.objectContaining({ action: 'product.create', entityId: product.id }),
    ]);
  });

  it('повтор идентификатора отклоняется', async () => {
    const { service } = setup();
    await service.create(ADMIN, { slug: 'demo', name: 'Один', oneLiner: 'Один' });

    await expect(
      service.create(ADMIN, { slug: 'demo', name: 'Два', oneLiner: 'Два' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('архивирование и возврат из архива пишутся отдельными записями аудита', async () => {
    const { catalog, service } = setup();
    const created = await service.create(ADMIN, { slug: 'demo', name: 'Демо', oneLiner: 'Пример' });

    const archived = await service.update(ADMIN, created.id, { archived: true }, NOW);
    expect(archived.archived).toBe(true);
    const restored = await service.update(ADMIN, created.id, { archived: false }, NOW);
    expect(restored.archived).toBe(false);

    expect(catalog.audit.map((record) => record.action)).toEqual([
      'product.create',
      'product.archive',
      'product.restore',
    ]);
  });

  it('правка названия фиксируется полем, повтор того же значения ничего не пишет', async () => {
    const { catalog, service } = setup();
    const created = await service.create(ADMIN, { slug: 'demo', name: 'Демо', oneLiner: 'Пример' });
    const auditBefore = catalog.audit.length;

    const renamed = await service.update(ADMIN, created.id, { name: 'Новое имя' }, NOW);
    expect(renamed.name).toBe('Новое имя');
    expect(catalog.audit.at(-1)).toMatchObject({
      action: 'product.update',
      payload: { fields: ['name'] },
    });

    await service.update(ADMIN, created.id, { name: 'Новое имя' }, NOW);
    expect(catalog.audit).toHaveLength(auditBefore + 1);
  });

  it('несуществующий продукт — 404', async () => {
    const { service } = setup();

    await expect(
      service.update(ADMIN, '00000000-0000-4000-8000-0000000000ff', { archived: true }, NOW),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
