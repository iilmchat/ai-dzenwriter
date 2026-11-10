import type {
  AuthorLoadRow,
  CalendarItemRow,
  CalendarRepository,
} from '../../src/calendar/calendar.repository';

// Календарь в памяти: фильтрация месяца и группировка как у DrizzleCalendarRepository.
export class InMemoryCalendarRepository implements CalendarRepository {
  constructor(readonly items: readonly CalendarItemRow[] = []) {}

  async listForMonth(monthStart: Date, monthEnd: Date): Promise<CalendarItemRow[]> {
    return this.items
      .filter((item) => item.plannedAt >= monthStart && item.plannedAt < monthEnd)
      .filter((item) => item.status !== 'published' && item.status !== 'archived')
      .sort((left, right) => left.plannedAt.getTime() - right.plannedAt.getTime());
  }

  async countByAuthor(monthStart: Date, monthEnd: Date): Promise<AuthorLoadRow[]> {
    const rows = await this.listForMonth(monthStart, monthEnd);
    const counts = new Map<string, AuthorLoadRow>();
    for (const row of rows) {
      const current = counts.get(row.ownerId);
      counts.set(row.ownerId, {
        ownerId: row.ownerId,
        ownerName: row.ownerName,
        count: (current?.count ?? 0) + 1,
      });
    }
    return [...counts.values()].sort((left, right) =>
      left.ownerName.localeCompare(right.ownerName, 'ru'),
    );
  }
}
