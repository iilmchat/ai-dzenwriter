import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import { DrizzleSearchRepository } from './drizzle-search.repository';
import { SearchController } from './search.controller';
import { SEARCH_REPOSITORY } from './search.repository';
import { SearchService } from './search.service';

@Module({
  imports: [DatabaseModule],
  controllers: [SearchController],
  providers: [
    SearchService,
    {
      provide: SEARCH_REPOSITORY,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) => new DrizzleSearchRepository(database.db),
    },
  ],
})
export class SearchModule {}
