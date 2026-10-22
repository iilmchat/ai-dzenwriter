import { ConfigError } from './errors';
import type { Env } from './env';

export interface LlmConfig {
  // mock — заглушка для тестов, CI и локального запуска без ключа.
  // openai — OpenAI-совместимый API.
  readonly provider: 'mock' | 'openai';
  readonly baseUrl: string | undefined;
  readonly apiKey: string | undefined;
  readonly model: string;
  readonly timeoutMs: number;
  // Лимит запусков на пользователя за сутки и общий суточный бюджет в долларах.
  readonly dailyLimitPerUser: number;
  readonly dailyBudgetUsd: number;
  // Цены провайдера в долларах за миллион токенов: из них считается cost_usd.
  readonly inputPricePerMtok: number;
  readonly outputPricePerMtok: number;
}

// Без ключа генерация работает на заглушке: сервис запускается, а запуск отвечает понятной ошибкой.
export function resolveLlmConfig(env: Env): LlmConfig {
  const base = {
    model: env.LLM_MODEL,
    timeoutMs: env.LLM_TIMEOUT_MS,
    dailyLimitPerUser: env.LLM_DAILY_LIMIT_PER_USER,
    dailyBudgetUsd: env.LLM_DAILY_BUDGET_USD,
    inputPricePerMtok: env.LLM_INPUT_PRICE_PER_MTOK,
    outputPricePerMtok: env.LLM_OUTPUT_PRICE_PER_MTOK,
  };

  if (env.LLM_PROVIDER === 'mock') {
    return { ...base, provider: 'mock', baseUrl: undefined, apiKey: undefined };
  }
  if (!env.LLM_BASE_URL || !env.LLM_API_KEY) {
    throw new ConfigError(
      'LLM_PROVIDER=openai требует LLM_BASE_URL и LLM_API_KEY: без них генерация не работает',
    );
  }
  return {
    ...base,
    provider: 'openai',
    baseUrl: env.LLM_BASE_URL,
    apiKey: env.LLM_API_KEY,
  };
}
