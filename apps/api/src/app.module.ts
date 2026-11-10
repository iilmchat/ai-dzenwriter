import { Module } from '@nestjs/common';
import { ArticlesModule } from './articles/articles.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CalendarModule } from './calendar/calendar.module';
import { CatalogModule } from './catalog/catalog.module';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { FactsModule } from './facts/facts.module';
import { GenerationModule } from './generation/generation.module';
import { HealthModule } from './health/health.module';
import { IdentityModule } from './identity/identity.module';
import { MetricsModule } from './metrics/metrics.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PilotModule } from './pilot/pilot.module';
import { PublicationsModule } from './publications/publications.module';
import { ReviewsModule } from './reviews/reviews.module';
import { SearchModule } from './search/search.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    IdentityModule,
    AuthModule,
    CalendarModule,
    UsersModule,
    CatalogModule,
    FactsModule,
    ArticlesModule,
    GenerationModule,
    PublicationsModule,
    ReviewsModule,
    SearchModule,
    MetricsModule,
    NotificationsModule,
    PilotModule,
    AuditModule,
    HealthModule,
  ],
})
export class AppModule {}
