import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Notification, NotificationType, NotificationsResponse } from '@dzenwriter/shared';
import {
  NOTIFICATIONS_REPOSITORY,
  type NotificationRow,
  type NotificationsRepository,
} from './notifications.repository';

export interface ActorRef {
  readonly id: string;
}

// Внутренние уведомления: создаются сервисами, читаются и отмечаются пользователем.
@Injectable()
export class NotificationsService {
  constructor(
    @Inject(NOTIFICATIONS_REPOSITORY) private readonly repository: NotificationsRepository,
  ) {}

  async notify(
    userId: string,
    type: NotificationType,
    message: string,
    entityId: string,
  ): Promise<void> {
    await this.repository.create({ userId, type, message, entityType: 'article', entityId });
  }

  async list(actor: ActorRef): Promise<NotificationsResponse> {
    const [rows, unreadCount] = await Promise.all([
      this.repository.listForUser(actor.id),
      this.repository.countUnread(actor.id),
    ]);
    return { items: rows.map(toNotification), unreadCount };
  }

  async markRead(actor: ActorRef, id: string): Promise<NotificationsResponse> {
    const marked = await this.repository.markAsRead(id, actor.id);
    if (!marked) {
      throw new NotFoundException('Уведомление не найдено');
    }
    return this.list(actor);
  }

  async markAllRead(actor: ActorRef): Promise<NotificationsResponse> {
    await this.repository.markAllAsRead(actor.id);
    return this.list(actor);
  }
}

function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    type: row.type,
    message: row.message,
    entityId: row.entityId,
    isRead: row.isRead,
    createdAt: row.createdAt.toISOString(),
  };
}
