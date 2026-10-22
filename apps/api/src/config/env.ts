import { z } from 'zod';
import { ConfigError, describeIssues } from './errors';

// Пустое значение в .env (секрет не задан, например в docker compose) считаем отсутствующим.
const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().refine((value) => /^postgres(ql)?:\/\//.test(value), {
    message: 'must start with postgres://',
  }),
  WEB_ORIGIN: z.url().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CONFIG_DIR: z.string().min(1).optional(),
  PROMPTS_DIR: z.string().min(1).optional(),
  GITHUB_CLIENT_ID: optionalText,
  GITHUB_CLIENT_SECRET: optionalText,
  GITHUB_ORG: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || 'iilmchat'),
  ADMIN_GITHUB_LOGINS: optionalText,
  LLM_PROVIDER: z.enum(['mock', 'openai']).default('mock'),
  LLM_BASE_URL: optionalText,
  LLM_API_KEY: optionalText,
  LLM_MODEL: z.string().trim().min(1).default('gpt-4o-mini'),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  // Лимит запусков на пользователя за сутки. 0 — без ограничения.
  LLM_DAILY_LIMIT_PER_USER: z.coerce.number().int().nonnegative().default(20),
  // Суточный бюджет генерации в долларах. 0 — без ограничения.
  LLM_DAILY_BUDGET_USD: z.coerce.number().nonnegative().default(5),
  LLM_INPUT_PRICE_PER_MTOK: z.coerce.number().nonnegative().default(0),
  LLM_OUTPUT_PRICE_PER_MTOK: z.coerce.number().nonnegative().default(0),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const lines = describeIssues(result.error.issues).map((line) => `  - ${line}`);
    throw new ConfigError(['Ошибка переменных окружения:', ...lines].join('\n'));
  }
  return result.data;
}
