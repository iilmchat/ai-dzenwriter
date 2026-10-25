import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/config/env';

describe('parseEnv', () => {
  it('применяет значения по умолчанию', () => {
    const env = parseEnv({ DATABASE_URL: 'postgres://user:pass@localhost:5432/db' });
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      API_PORT: 4000,
      LOG_LEVEL: 'info',
      WEB_ORIGIN: 'http://localhost:5173',
      RATE_LIMIT_MAX: 300,
      AUTH_RATE_LIMIT_MAX: 30,
    });
  });

  it('требует положительные значения лимитов запросов', () => {
    expect(() => parseEnv({ DATABASE_URL: 'postgres://x', RATE_LIMIT_MAX: '0' })).toThrow(
      /RATE_LIMIT_MAX/,
    );
    expect(() => parseEnv({ DATABASE_URL: 'postgres://x', AUTH_RATE_LIMIT_MAX: '-1' })).toThrow(
      /AUTH_RATE_LIMIT_MAX/,
    );
  });

  it('требует DATABASE_URL и называет переменную в ошибке', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it('требует протокол postgres в DATABASE_URL', () => {
    expect(() => parseEnv({ DATABASE_URL: 'mysql://localhost/db' })).toThrow(/DATABASE_URL/);
  });

  it('проверяет диапазон API_PORT', () => {
    expect(() => parseEnv({ DATABASE_URL: 'postgres://x', API_PORT: '99999' })).toThrow(/API_PORT/);
  });
});
