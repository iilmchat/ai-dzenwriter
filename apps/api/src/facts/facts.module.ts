import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import { DrizzleFactsRepository } from './drizzle-facts.repository';
import { FactsController } from './facts.controller';
import { FACTS_REPOSITORY } from './facts.repository';
import { FactsService } from './facts.service';

@Module({
  imports: [DatabaseModule, CatalogModule],
  controllers: [FactsController],
  providers: [
    FactsService,
    {
      provide: FACTS_REPOSITORY,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) => new DrizzleFactsRepository(database.db),
    },
  ],
  exports: [FACTS_REPOSITORY],
})
export class FactsModule {}
