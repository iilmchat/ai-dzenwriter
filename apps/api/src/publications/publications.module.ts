import { Module } from '@nestjs/common';
import { ArticlesModule } from '../articles/articles.module';
import { CatalogModule } from '../catalog/catalog.module';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import { DrizzlePublicationsRepository } from './drizzle-publications.repository';
import { PUBLICATIONS_REPOSITORY } from './publications.repository';
import { PublicationsController } from './publications.controller';
import { PublicationsService } from './publications.service';

@Module({
  imports: [DatabaseModule, ArticlesModule, CatalogModule],
  controllers: [PublicationsController],
  providers: [
    PublicationsService,
    {
      provide: PUBLICATIONS_REPOSITORY,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) => new DrizzlePublicationsRepository(database.db),
    },
  ],
})
export class PublicationsModule {}
