import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import { NotificationsController } from './notifications.controller';
import { NOTIFICATIONS_REPOSITORY } from './notifications.repository';
import { NotificationsService } from './notifications.service';
import { DrizzleNotificationsRepository } from './drizzle-notifications.repository';

@Module({
  imports: [DatabaseModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    {
      provide: NOTIFICATIONS_REPOSITORY,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) => new DrizzleNotificationsRepository(database.db),
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
