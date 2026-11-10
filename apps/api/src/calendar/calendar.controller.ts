import { Controller, Get, Query } from '@nestjs/common';
import type { CalendarResponse } from '@dzenwriter/shared';
import { CalendarService } from './calendar.service';

@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  // Календарь плановых дат доступен всем вошедшим.
  @Get()
  get(@Query('month') month: string | undefined): Promise<CalendarResponse> {
    return this.calendar.getCalendar(month ?? '');
  }
}
