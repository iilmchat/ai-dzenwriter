import { Module } from '@nestjs/common';
import { ArticlesModule } from '../articles/articles.module';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import { DrizzleMetricsRepository } from './drizzle-metrics.repository';
import { METRICS_REPOSITORY } from './metrics.repository';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

@Module({
  imports: [DatabaseModule, ArticlesModule],
  controllers: [MetricsController],
  providers: [
    MetricsService,
    {
      provide: METRICS_REPOSITORY,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) => new DrizzleMetricsRepository(database.db),
    },
  ],
})
export class MetricsModule {}
