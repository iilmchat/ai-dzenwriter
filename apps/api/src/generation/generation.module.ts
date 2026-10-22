import { Module } from '@nestjs/common';
import { ArticlesModule } from '../articles/articles.module';
import { CatalogModule } from '../catalog/catalog.module';
import { ChecksModule } from '../checks/checks.module';
import { LLM_CONFIG } from '../config/tokens';
import type { LlmConfig } from '../config/llm-config';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import { DrizzleGenerationRepository } from './drizzle-generation.repository';
import { GENERATION_REPOSITORY } from './generation.repository';
import { GenerationController } from './generation.controller';
import { GenerationService } from './generation.service';
import { LLM_PROVIDER, type LlmProvider } from './llm-provider';
import { MockLlmProvider } from './mock-provider';
import { OpenAiCompatibleProvider } from './openai-provider';

@Module({
  imports: [DatabaseModule, ArticlesModule, CatalogModule, ChecksModule],
  controllers: [GenerationController],
  providers: [
    GenerationService,
    {
      provide: GENERATION_REPOSITORY,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) => new DrizzleGenerationRepository(database.db),
    },
    // Провайдера выбирает конфигурация: mock по умолчанию, openai — когда заданы ключ и адрес.
    {
      provide: LLM_PROVIDER,
      inject: [LLM_CONFIG],
      useFactory: (llm: LlmConfig): LlmProvider =>
        llm.provider === 'openai'
          ? new OpenAiCompatibleProvider({
              baseUrl: llm.baseUrl ?? '',
              apiKey: llm.apiKey ?? '',
              model: llm.model,
              timeoutMs: llm.timeoutMs,
              inputPricePerMtok: llm.inputPricePerMtok,
              outputPricePerMtok: llm.outputPricePerMtok,
            })
          : new MockLlmProvider(),
    },
  ],
})
export class GenerationModule {}
