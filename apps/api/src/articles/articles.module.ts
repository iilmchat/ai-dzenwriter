import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import { ArticlesController } from './articles.controller';
import { DrizzleArticlesRepository } from './drizzle-articles.repository';
import { ArticlesService } from './articles.service';
import { ARTICLES_REPOSITORY } from './articles.repository';

@Module({
  imports: [DatabaseModule, CatalogModule],
  controllers: [ArticlesController],
  providers: [
    ArticlesService,
    {
      provide: ARTICLES_REPOSITORY,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) => new DrizzleArticlesRepository(database.db),
    },
  ],
})
export class ArticlesModule {}
