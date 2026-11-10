import { randomUUID } from 'node:crypto';
import type {
  NewNotification,
  NotificationRow,
  NotificationsRepository,
} from '../../src/notifications/notifications.repository';

// Репозиторий уведомлений в памяти: та же семантика, что у Drizzle-репозитория.
export class InMemoryNotificationsRepository implements NotificationsRepository {
  readonly rows: NotificationRow[] = [];
  readonly clock = new Date('2026-10-22T10:00:00Z');

  async create(input: NewNotification): Promise<NotificationRow> {
    const row: NotificationRow = {
      id: randomUUID(),
      userId: input.userId,
      type: input.type,
      message: input.message,
      entityType: input.entityType,
      entityId: input.entityId,
      isRead: false,
      createdAt: this.clock,
    };
    this.rows.push(row);
    return row;
  }

  async listForUser(userId: string): Promise<NotificationRow[]> {
    return this.rows
      .filter((row) => row.userId === userId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  }

  async countUnread(userId: string): Promise<number> {
    return this.rows.filter((row) => row.userId === userId && !row.isRead).length;
  }

  async markAsRead(id: string, userId: string): Promise<boolean> {
    const index = this.rows.findIndex((row) => row.id === id && row.userId === userId);
    const row = this.rows[index];
    if (row === undefined) {
      return false;
    }
    this.rows[index] = { ...row, isRead: true };
    return true;
  }

  async markAllAsRead(userId: string): Promise<number> {
    let count = 0;
    for (let index = 0; index < this.rows.length; index += 1) {
      const row = this.rows[index];
      if (row !== undefined && row.userId === userId && !row.isRead) {
        this.rows[index] = { ...row, isRead: true };
        count += 1;
      }
    }
    return count;
  }
}
