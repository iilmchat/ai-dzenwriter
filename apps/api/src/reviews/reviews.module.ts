import { Module } from '@nestjs/common';
import { ArticlesModule } from '../articles/articles.module';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import { DrizzleReviewsRepository } from './drizzle-reviews.repository';
import { ReviewsController } from './reviews.controller';
import { REVIEWS_REPOSITORY } from './reviews.repository';
import { ReviewsService } from './reviews.service';

@Module({
  imports: [DatabaseModule, ArticlesModule],
  controllers: [ReviewsController],
  providers: [
    ReviewsService,
    {
      provide: REVIEWS_REPOSITORY,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) => new DrizzleReviewsRepository(database.db),
    },
  ],
  exports: [ReviewsService],
})
export class ReviewsModule {}
