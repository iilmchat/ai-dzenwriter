import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/config/env';
import { resolveAuthConfig } from '../src/config/auth-config';
import { readCookie, sessionCookieOptions } from '../src/auth/cookies';
import { createOpaqueToken, hashSessionToken } from '../src/auth/session-token';

const DATABASE_URL = 'postgres://user:pass@localhost:5432/db';

describe('resolveAuthConfig', () => {
  it('без секретов вход выключен, а сервис запускается', () => {
    const config = resolveAuthConfig(parseEnv({ DATABASE_URL }));

    expect(config.github).toBeUndefined();
  });

  it('пустые значения в .env считаются не заданными', () => {
    const config = resolveAuthConfig(
      parseEnv({ DATABASE_URL, GITHUB_CLIENT_ID: '', GITHUB_CLIENT_SECRET: '' }),
    );

    expect(config.github).toBeUndefined();
  });

  it('секрет без идентификатора приложения не даёт запуститься', () => {
    const env = parseEnv({ DATABASE_URL, GITHUB_CLIENT_SECRET: 'secret' });

    expect(() => resolveAuthConfig(env)).toThrow(/GITHUB_CLIENT_ID и GITHUB_CLIENT_SECRET/);
  });

  it('callback строится от WEB_ORIGIN, логины администраторов приводятся к нижнему регистру', () => {
    const config = resolveAuthConfig(
      parseEnv({
        DATABASE_URL,
        WEB_ORIGIN: 'http://localhost:8080/',
        GITHUB_CLIENT_ID: 'id',
        GITHUB_CLIENT_SECRET: 'secret',
        ADMIN_GITHUB_LOGINS: ' Anna, boris ,',
      }),
    );

    expect(config.webOrigin).toBe('http://localhost:8080');
    expect(config.secureCookies).toBe(false);
    expect(config.github).toMatchObject({
      org: 'iilmchat',
      adminLogins: ['anna', 'boris'],
      callbackUrl: 'http://localhost:8080/api/v1/auth/github/callback',
    });
  });

  it('cookie становятся Secure, когда приложение открыто по https', () => {
    const config = resolveAuthConfig(
      parseEnv({ DATABASE_URL, WEB_ORIGIN: 'https://dzen.example' }),
    );

    expect(config.secureCookies).toBe(true);
  });
});

describe('cookie и токены', () => {
  it('readCookie находит нужное имя среди других cookie', () => {
    expect(readCookie('a=1; dzw_session=abc-_9; b=2', 'dzw_session')).toBe('abc-_9');
  });

  it('readCookie возвращает undefined для отсутствующего или пустого значения', () => {
    expect(readCookie(undefined, 'dzw_session')).toBeUndefined();
    expect(readCookie('dzw_session=; a=1', 'dzw_session')).toBeUndefined();
    expect(readCookie('other=1', 'dzw_session')).toBeUndefined();
  });

  it('cookie сессии HttpOnly, SameSite=Lax и живёт 30 дней', () => {
    expect(sessionCookieOptions(true)).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  });

  it('токены уникальны и не совпадают с хешем', () => {
    const first = createOpaqueToken();
    const second = createOpaqueToken();

    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashSessionToken(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(first)).not.toBe(first);
  });
});
