import type { ArticleStatus } from '@dzenwriter/shared';

export const CALENDAR_REPOSITORY = Symbol('CALENDAR_REPOSITORY');

export interface CalendarItemRow {
  readonly id: string;
  readonly topic: string;
  readonly status: ArticleStatus;
  readonly ownerId: string;
  readonly ownerName: string;
  readonly plannedAt: Date;
  readonly styleId: string;
}

export interface AuthorLoadRow {
  readonly ownerId: string;
  readonly ownerName: string;
  readonly count: number;
}

export interface CalendarRepository {
  // Статьи с плановой датой в интервале [monthStart, monthEnd), кроме опубликованных и архивных.
  listForMonth(monthStart: Date, monthEnd: Date): Promise<CalendarItemRow[]>;
  countByAuthor(monthStart: Date, monthEnd: Date): Promise<AuthorLoadRow[]>;
}
