import { Module } from '@nestjs/common';
import { LLM_CONFIG } from '../config/tokens';
import type { LlmConfig } from '../config/llm-config';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import { DrizzleGenerationRepository } from './drizzle-generation.repository';
import { GenerationLimitsService } from './generation-limits.service';
import { GENERATION_REPOSITORY } from './generation.repository';
import { LLM_PROVIDER, type LlmProvider } from './llm-provider';
import { MockLlmProvider } from './mock-provider';
import { OpenAiCompatibleProvider } from './openai-provider';

// Общий LLM-слой: провайдер, история запусков и дневные лимиты.
// Его импортируют и генерация текста, и бриф — без циклических зависимостей модулей.
@Module({
  imports: [DatabaseModule],
  providers: [
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
    GenerationLimitsService,
  ],
  exports: [GENERATION_REPOSITORY, LLM_PROVIDER, GenerationLimitsService],
})
export class LlmModule {}
