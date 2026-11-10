import type { NotificationType } from '@dzenwriter/shared';

export const NOTIFICATIONS_REPOSITORY = Symbol('NOTIFICATIONS_REPOSITORY');

export interface NotificationRow {
  readonly id: string;
  readonly userId: string;
  readonly type: NotificationType;
  readonly message: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly isRead: boolean;
  readonly createdAt: Date;
}

export interface NewNotification {
  readonly userId: string;
  readonly type: NotificationType;
  readonly message: string;
  readonly entityType: 'article';
  readonly entityId: string;
}

export interface NotificationsRepository {
  create(input: NewNotification): Promise<NotificationRow>;
  // Свежие уведомления первыми; глубокая история не нужна для колокольчика.
  listForUser(userId: string): Promise<NotificationRow[]>;
  countUnread(userId: string): Promise<number>;
  // true — уведомление найдено и принадлежит пользователю.
  markAsRead(id: string, userId: string): Promise<boolean>;
  markAllAsRead(userId: string): Promise<number>;
}
