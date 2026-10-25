import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuditService } from '../src/audit/audit.service';
import { InMemoryAuditRepository } from './support/in-memory-audit.repository';

describe('сервис журнала аудита', () => {
  const repository = new InMemoryAuditRepository();
  const service = new AuditService(repository);

  beforeEach(() => {
    repository.rows.length = 0;
    repository.addEntry({
      action: 'article.transition',
      entityType: 'article',
      entityId: 'a1',
      payload: { from: 'drafting', to: 'in_review' },
      actorId: '00000000-0000-4000-8000-000000000001',
      actorLogin: 'boris',
      createdAt: new Date('2026-10-25T09:00:00.000Z'),
    });
    repository.addEntry({
      action: 'fact.create',
      entityType: 'fact',
      entityId: 'f1',
      payload: { type: 'company_fact' },
      actorId: '00000000-0000-4000-8000-00000000f001',
      actorLogin: 'anna',
      createdAt: new Date('2026-10-25T10:00:00.000Z'),
    });
  });

  afterEach(() => {
    repository.rows.length = 0;
  });

  it('возвращает журнал от новых к старым', async () => {
    const response = await service.list({});

    expect(response.truncated).toBe(false);
    expect(response.items.map((entry) => entry.action)).toEqual([
      'fact.create',
      'article.transition',
    ]);
  });

  it('payload и границы периодов сохраняются', async () => {
    const response = await service.list({});

    expect(response.items[0]?.payload).toEqual({ type: 'company_fact' });
    expect(response.items[0]?.createdAt).toBe('2026-10-25T10:00:00.000Z');
  });

  it('фильтр по действию, сущности и исполнителю', async () => {
    const byAction = await service.list({ action: 'fact.create' });
    expect(byAction.items).toHaveLength(1);

    const byEntity = await service.list({ entityType: 'fact' });
    expect(byEntity.items).toHaveLength(1);

    const byActor = await service.list({ actorId: '00000000-0000-4000-8000-000000000001' });
    expect(byActor.items.map((entry) => entry.action)).toEqual(['article.transition']);
  });

  it('период включает границы', async () => {
    const response = await service.list({
      from: '2026-10-25T09:00:00.000Z',
      to: '2026-10-25T09:00:00.999Z',
    });

    expect(response.items.map((entry) => entry.action)).toEqual(['article.transition']);
  });

  it('журнал обрезается по лимиту и помечает это', async () => {
    for (let index = 0; index < 600; index += 1) {
      repository.addEntry({
        action: 'article.update',
        entityType: 'article',
        entityId: `a-${index}`,
        payload: {},
        createdAt: new Date(2026, 9, 1, 0, 0, index),
      });
    }

    const response = await service.list({});

    expect(response.items).toHaveLength(500);
    expect(response.truncated).toBe(true);
  });
});
