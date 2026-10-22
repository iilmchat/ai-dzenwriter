import { Module } from '@nestjs/common';
import { ArticlesModule } from './articles/articles.module';
import { AuthModule } from './auth/auth.module';
import { CatalogModule } from './catalog/catalog.module';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { FactsModule } from './facts/facts.module';
import { GenerationModule } from './generation/generation.module';
import { HealthModule } from './health/health.module';
import { IdentityModule } from './identity/identity.module';
import { PublicationsModule } from './publications/publications.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    IdentityModule,
    AuthModule,
    UsersModule,
    CatalogModule,
    FactsModule,
    ArticlesModule,
    GenerationModule,
    PublicationsModule,
    HealthModule,
  ],
})
export class AppModule {}
