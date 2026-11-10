import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import { CalendarController } from './calendar.controller';
import { CALENDAR_REPOSITORY } from './calendar.repository';
import { CalendarService } from './calendar.service';
import { DrizzleCalendarRepository } from './drizzle-calendar.repository';

@Module({
  imports: [DatabaseModule],
  controllers: [CalendarController],
  providers: [
    CalendarService,
    {
      provide: CALENDAR_REPOSITORY,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) => new DrizzleCalendarRepository(database.db),
    },
  ],
})
export class CalendarModule {}
