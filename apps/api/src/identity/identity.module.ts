import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import { DrizzleIdentityRepository } from './drizzle-identity.repository';
import { IDENTITY_REPOSITORY } from './identity.repository';

@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: IDENTITY_REPOSITORY,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) => new DrizzleIdentityRepository(database.db),
    },
  ],
  exports: [IDENTITY_REPOSITORY],
})
export class IdentityModule {}
