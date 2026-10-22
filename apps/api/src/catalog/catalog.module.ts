import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import { CatalogController } from './catalog.controller';
import { CATALOG_REPOSITORY } from './catalog.repository';
import { DrizzleCatalogRepository } from './drizzle-catalog.repository';
import { ProductsService } from './products.service';

@Module({
  imports: [DatabaseModule],
  controllers: [CatalogController],
  providers: [
    ProductsService,
    {
      provide: CATALOG_REPOSITORY,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) => new DrizzleCatalogRepository(database.db),
    },
  ],
  exports: [CATALOG_REPOSITORY],
})
export class CatalogModule {}
