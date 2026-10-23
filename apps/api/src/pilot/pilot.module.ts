import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import { DrizzlePilotRepository } from './drizzle-pilot.repository';
import { PILOT_REPOSITORY } from './pilot.repository';
import { PilotController } from './pilot.controller';
import { PilotService } from './pilot.service';

@Module({
  imports: [DatabaseModule],
  controllers: [PilotController],
  providers: [
    PilotService,
    {
      provide: PILOT_REPOSITORY,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) => new DrizzlePilotRepository(database.db),
    },
  ],
})
export class PilotModule {}
