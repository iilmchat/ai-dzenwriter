import { z } from 'zod';
import { ARTICLE_STATUSES } from './enums';

// Плановая дата материала в календаре. Время приходит ISO, день считается по UTC.
export const calendarItemSchema = z.object({
  id: z.uuid(),
  topic: z.string(),
  status: z.enum(ARTICLE_STATUSES),
  ownerId: z.uuid(),
  ownerName: z.string(),
  plannedAt: z.iso.datetime(),
  styleId: z.string(),
});
export type CalendarItem = z.infer<typeof calendarItemSchema>;

export const authorLoadSchema = z.object({
  ownerId: z.uuid(),
  ownerName: z.string(),
  count: z.number().int().nonnegative(),
});
export type AuthorLoad = z.infer<typeof authorLoadSchema>;

export const calendarResponseSchema = z.object({
  items: z.array(calendarItemSchema),
  authorLoad: z.array(authorLoadSchema),
});
export type CalendarResponse = z.infer<typeof calendarResponseSchema>;
