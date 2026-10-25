import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { parseEnv } from '../src/config/env';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
// Недостижимый адрес нужен только позднему тесту /ready, он не мешает лимитам.
const unreachableDatabaseUrl = 'postgres://nobody:nobody@127.0.0.1:1/none';

// Отдельное приложение с крошечными лимитами: счётчики лимитеров живут
// в памяти экземпляра, поэтому это описание не мешает остальным файлам тестов.
describe('Rate limiting API (429)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl ?? unreachableDatabaseUrl;
    const env = parseEnv({ ...process.env, RATE_LIMIT_MAX: '2', AUTH_RATE_LIMIT_MAX: '1' });

    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app, env, pino({ level: 'silent' }));
    await app.listen(0, '127.0.0.1');

    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') {
      throw new Error('Сервер не получил порт');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('энды входа ограничены жёстко и отвечают 429 в problem+json', async () => {
    // OAuth не настроен: нормальный 302 назад на /login, но запрос считается лимитером.
    // redirect: manual — fetch не должен ходить по редиректу на заглушку веба.
    const first = await fetch(`${baseUrl}/api/v1/auth/github/start`, { redirect: 'manual' });
    expect(first.status).toBe(302);
    // Draft-7 шлёт один сводный заголовок RateLimit: limit=1, remaining=0, reset=...
    expect(first.headers.get('ratelimit') ?? '').toContain('limit=1');

    const second = await fetch(`${baseUrl}/api/v1/auth/github/start`, { redirect: 'manual' });
    expect(second.status).toBe(429);
    expect(second.headers.get('content-type')).toContain('application/problem+json');
    expect(second.headers.get('retry-after')).toBeTruthy();
    const body = (await second.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: 'about:blank',
      status: 429,
      title: 'Too Many Requests',
      instance: '/api/v1/auth/github/start',
    });
    expect(typeof body.requestId).toBe('string');
  });

  it('общий лимит на /api/v1 срабатывает, а health-энды не считается', async () => {
    // /me без сессии отвечает 401 — запрос всё равно расходует общий лимит.
    const first = await fetch(`${baseUrl}/api/v1/me`);
    expect(first.status).toBe(401);
    const second = await fetch(`${baseUrl}/api/v1/me`);
    expect(second.status).toBe(401);

    const third = await fetch(`${baseUrl}/api/v1/me`);
    expect(third.status).toBe(429);
    expect(third.headers.get('content-type')).toContain('application/problem+json');
    expect(third.headers.get('retry-after')).toBeTruthy();

    // Health-энды вне /api/v1: даже с исчерпанным лимитом /ready отвечает.
    const ready = await fetch(`${baseUrl}/ready`);
    expect(ready.status).toBe(testDatabaseUrl ? 200 : 503);
  });
});
