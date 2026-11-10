import { calendarResponseSchema, type CalendarResponse } from '@dzenwriter/shared';
import { apiRequest } from './client';

export function fetchCalendar(month: string): Promise<CalendarResponse> {
  const params = new URLSearchParams({ month });
  return apiRequest(`/api/v1/calendar?${params.toString()}`, {
    schema: calendarResponseSchema,
  });
}
