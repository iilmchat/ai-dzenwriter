import { z } from 'zod';

// Внутренние уведомления: только HTTP API и React, без внешних каналов.
export const NOTIFICATION_TYPES = [
  'article_returned',
  'article_approved',
  'review_requested',
  'generation_failed',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const notificationSchema = z.object({
  id: z.uuid(),
  type: z.enum(NOTIFICATION_TYPES),
  message: z.string(),
  entityId: z.uuid(),
  isRead: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationsResponseSchema = z.object({
  items: z.array(notificationSchema),
  unreadCount: z.number().int().nonnegative(),
});
export type NotificationsResponse = z.infer<typeof notificationsResponseSchema>;
