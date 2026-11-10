import { notificationsResponseSchema, type NotificationsResponse } from '@dzenwriter/shared';
import { apiRequest } from './client';

export function fetchNotifications(): Promise<NotificationsResponse> {
  return apiRequest('/api/v1/notifications', { schema: notificationsResponseSchema });
}

export function markNotificationRead(id: string): Promise<NotificationsResponse> {
  return apiRequest(`/api/v1/notifications/${id}/read`, {
    method: 'PATCH',
    schema: notificationsResponseSchema,
  });
}

export function markAllNotificationsRead(): Promise<NotificationsResponse> {
  return apiRequest('/api/v1/notifications/read-all', {
    method: 'POST',
    schema: notificationsResponseSchema,
  });
}
