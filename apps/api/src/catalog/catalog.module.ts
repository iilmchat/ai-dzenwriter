import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import { CatalogController } from './catalog.controller';
import { CATALOG_REPOSITORY } from './catalog.repository';
import { DrizzleCatalogRepository } from './drizzle-catalog.repository';

@Module({
  imports: [DatabaseModule],
  controllers: [CatalogController],
  providers: [
    {
      provide: CATALOG_REPOSITORY,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) => new DrizzleCatalogRepository(database.db),
    },
  ],
  exports: [CATALOG_REPOSITORY],
})
export class CatalogModule {}
