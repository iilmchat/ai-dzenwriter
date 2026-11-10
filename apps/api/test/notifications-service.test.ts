import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { NotificationsService } from '../src/notifications/notifications.service';
import { InMemoryNotificationsRepository } from './support/in-memory-notifications.repository';

const ALICE = { id: '00000000-0000-4000-8000-000000000001' };
const BOB = { id: '00000000-0000-4000-8000-000000000002' };
const ARTICLE = '00000000-0000-4000-8000-0000000000a1';

function setup() {
  const repository = new InMemoryNotificationsRepository();
  return { repository, service: new NotificationsService(repository) };
}

describe('уведомления', () => {
  it('создаёт уведомление и считает непрочитанные', async () => {
    const { service } = setup();

    await service.notify(ALICE.id, 'article_approved', 'Статья утверждена: тема', ARTICLE);

    const response = await service.list(ALICE);

    expect(response.unreadCount).toBe(1);
    expect(response.items).toEqual([
      expect.objectContaining({
        type: 'article_approved',
        message: 'Статья утверждена: тема',
        entityId: ARTICLE,
        isRead: false,
      }),
    ]);
    expect(response.items[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('отмечает одно уведомление прочитанным только у владельца', async () => {
    const { service } = setup();
    await service.notify(ALICE.id, 'article_returned', 'Вернули на доработку', ARTICLE);
    const listed = await service.list(ALICE);
    const id = listed.items[0]?.id ?? '';

    await expect(service.markRead(BOB, id)).rejects.toBeInstanceOf(NotFoundException);

    const after = await service.markRead(ALICE, id);

    expect(after.unreadCount).toBe(0);
    expect(after.items[0]).toMatchObject({ id, isRead: true });
  });

  it('отмечает все уведомления прочитанными', async () => {
    const { service } = setup();
    await service.notify(ALICE.id, 'review_requested', 'Первое', ARTICLE);
    await service.notify(ALICE.id, 'generation_failed', 'Второе', ARTICLE);
    await service.notify(BOB.id, 'article_approved', 'Чужое', ARTICLE);

    const response = await service.markAllRead(ALICE);

    expect(response.unreadCount).toBe(0);
    expect(response.items.every((item) => item.isRead)).toBe(true);
    expect((await service.list(BOB)).unreadCount).toBe(1);
  });
});
