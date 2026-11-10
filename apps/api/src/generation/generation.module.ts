import { Module } from '@nestjs/common';
import { ArticlesModule } from '../articles/articles.module';
import { CatalogModule } from '../catalog/catalog.module';
import { ChecksModule } from '../checks/checks.module';
import { DatabaseModule } from '../database/database.module';
import { GenerationController } from './generation.controller';
import { GenerationService } from './generation.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { LlmModule } from './llm.module';

@Module({
  imports: [
    DatabaseModule,
    ArticlesModule,
    CatalogModule,
    ChecksModule,
    LlmModule,
    NotificationsModule,
  ],
  controllers: [GenerationController],
  providers: [GenerationService],
})
export class GenerationModule {}
