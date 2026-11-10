import { notifications } from '@dzenwriter/db';
import type { NotificationType } from '@dzenwriter/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { DbHandle } from '../database/db-handle';
import type {
  NewNotification,
  NotificationRow,
  NotificationsRepository,
} from './notifications.repository';

// Колокольчик показывает свежие события: старые доступны через историю материала.
const LIST_LIMIT = 50;

const selection = {
  id: notifications.id,
  userId: notifications.userId,
  type: notifications.type,
  message: notifications.message,
  entityType: notifications.entityType,
  entityId: notifications.entityId,
  isRead: notifications.isRead,
  createdAt: notifications.createdAt,
};

export class DrizzleNotificationsRepository implements NotificationsRepository {
  constructor(private readonly db: DbHandle) {}

  async create(input: NewNotification): Promise<NotificationRow> {
    const [row] = await this.db
      .insert(notifications)
      .values({
        userId: input.userId,
        type: input.type,
        message: input.message,
        entityType: input.entityType,
        entityId: input.entityId,
      })
      .returning(selection);
    if (!row) {
      throw new Error('Уведомление не сохранилось');
    }
    return toRow(row);
  }

  async listForUser(userId: string): Promise<NotificationRow[]> {
    const rows = await this.db
      .select(selection)
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(LIST_LIMIT);
    return rows.map(toRow);
  }

  async countUnread(userId: string): Promise<number> {
    const rows = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
    return rows[0]?.total ?? 0;
  }

  async markAsRead(id: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .returning({ id: notifications.id });
    return rows.length > 0;
  }

  async markAllAsRead(userId: string): Promise<number> {
    const rows = await this.db
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)))
      .returning({ id: notifications.id });
    return rows.length;
  }
}

function toRow(row: {
  readonly id: string;
  readonly userId: string;
  readonly type: string;
  readonly message: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly isRead: boolean;
  readonly createdAt: Date;
}): NotificationRow {
  return {
    ...row,
    type: row.type as NotificationType,
  };
}
