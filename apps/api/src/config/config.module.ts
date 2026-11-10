import { Global, Module } from '@nestjs/common';
import { loadAppConfig, resolveConfigDir, type AppConfig } from './app-config';
import { resolveAuthConfig, type AuthConfig } from './auth-config';
import { parseEnv, type Env } from './env';
import { resolveLlmConfig, type LlmConfig } from './llm-config';
import {
  loadBasePrompt,
  loadBriefPrompt,
  loadExpandPrompt,
  resolvePromptsDir,
} from './prompt-config';
import {
  APP_CONFIG,
  AUTH_CONFIG,
  BASE_PROMPT,
  BRIEF_PROMPT,
  ENV,
  EXPAND_PROMPT,
  LLM_CONFIG,
} from './tokens';

// Конфигурация читается при старте: если окружение, config/ или prompts/ неверны,
// сервис не запустится.
@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: (): Env => parseEnv(process.env) },
    {
      provide: APP_CONFIG,
      inject: [ENV],
      useFactory: (env: Env): AppConfig => loadAppConfig(resolveConfigDir(env.CONFIG_DIR)),
    },
    {
      provide: AUTH_CONFIG,
      inject: [ENV],
      useFactory: (env: Env): AuthConfig => resolveAuthConfig(env),
    },
    {
      provide: LLM_CONFIG,
      inject: [ENV],
      useFactory: (env: Env): LlmConfig => resolveLlmConfig(env),
    },
    {
      provide: BASE_PROMPT,
      inject: [ENV],
      useFactory: (env: Env): string => loadBasePrompt(resolvePromptsDir(env.PROMPTS_DIR)),
    },
    {
      provide: EXPAND_PROMPT,
      inject: [ENV],
      useFactory: (env: Env): string => loadExpandPrompt(resolvePromptsDir(env.PROMPTS_DIR)),
    },
    {
      provide: BRIEF_PROMPT,
      inject: [ENV],
      useFactory: (env: Env): string => loadBriefPrompt(resolvePromptsDir(env.PROMPTS_DIR)),
    },
  ],
  exports: [ENV, APP_CONFIG, AUTH_CONFIG, LLM_CONFIG, BASE_PROMPT, EXPAND_PROMPT, BRIEF_PROMPT],
})
export class ConfigModule {}
