import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { CalendarItem, CalendarResponse } from '@dzenwriter/shared';
import {
  CALENDAR_REPOSITORY,
  type CalendarItemRow,
  type CalendarRepository,
} from './calendar.repository';

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

@Injectable()
export class CalendarService {
  constructor(@Inject(CALENDAR_REPOSITORY) private readonly repository: CalendarRepository) {}

  async getCalendar(month: string): Promise<CalendarResponse> {
    const match = MONTH_PATTERN.exec(month);
    if (!match) {
      throw new BadRequestException('Месяц должен быть в формате YYYY-MM');
    }
    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const monthStart = new Date(Date.UTC(year, monthIndex, 1));
    const monthEnd = new Date(Date.UTC(year, monthIndex + 1, 1));

    const [items, authorLoad] = await Promise.all([
      this.repository.listForMonth(monthStart, monthEnd),
      this.repository.countByAuthor(monthStart, monthEnd),
    ]);
    return { items: items.map(toItem), authorLoad };
  }
}

function toItem(row: CalendarItemRow): CalendarItem {
  return {
    id: row.id,
    topic: row.topic,
    status: row.status,
    ownerId: row.ownerId,
    ownerName: row.ownerName,
    plannedAt: row.plannedAt.toISOString(),
    styleId: row.styleId,
  };
}
