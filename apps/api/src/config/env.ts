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
  GITHUB_CLIENT_ID: optionalText,
  GITHUB_CLIENT_SECRET: optionalText,
  GITHUB_ORG: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || 'iilmchat'),
  ADMIN_GITHUB_LOGINS: optionalText,
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
