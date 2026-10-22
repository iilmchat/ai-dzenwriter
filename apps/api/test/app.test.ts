import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { parseEnv } from '../src/config/env';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
// Недостижимый адрес: без тестовой базы /ready должен честно вернуть 503.
const unreachableDatabaseUrl = 'postgres://nobody:nobody@127.0.0.1:1/none';

describe('HTTP-слой API', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl ?? unreachableDatabaseUrl;
    const env = parseEnv(process.env);

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

  it('GET /health отвечает без обращения к базе', async () => {
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('GET /ready проверяет базу', async () => {
    const response = await fetch(`${baseUrl}/ready`);
    const body = (await response.json()) as { status: string; checks: { database: string } };

    const ready = Boolean(testDatabaseUrl);
    expect(response.status).toBe(ready ? 200 : 503);
    expect(body.status).toBe(ready ? 'ready' : 'unavailable');
    expect(body.checks.database).toBe(ready ? 'ok' : 'error');
  });

  it('неизвестный маршрут отвечает problem+json с requestId из заголовка', async () => {
    const response = await fetch(`${baseUrl}/api/v1/unknown`, {
      headers: { 'x-request-id': 'test-request-1' },
    });

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    expect(await response.json()).toMatchObject({
      status: 404,
      instance: '/api/v1/unknown',
      requestId: 'test-request-1',
    });
  });
});
