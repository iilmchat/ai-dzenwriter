import { Module } from '@nestjs/common';
import { ArticlesModule } from '../articles/articles.module';
import { DatabaseModule } from '../database/database.module';
import { FactsModule } from '../facts/facts.module';
import { GenerationModule } from '../generation/generation.module';
import { LlmModule } from '../generation/llm.module';
import { AutopilotController } from './autopilot.controller';
import { AutopilotService } from './autopilot.service';

@Module({
  imports: [DatabaseModule, ArticlesModule, FactsModule, GenerationModule, LlmModule],
  controllers: [AutopilotController],
  providers: [AutopilotService],
})
export class AutopilotModule {}
