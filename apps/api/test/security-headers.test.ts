import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import pino from 'pino';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { parseEnv } from '../src/config/env';

// Конфигурационные гарантии безопасности: CORS отвечает только своему вебу,
// nginx-конфиг держит строгий CSP, а index.html не тянет шрифты с внешнего CDN.
describe('Безопасные заголовки и CSP', () => {
  let app: INestApplication;
  let baseUrl: string;
  let webOrigin: string;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL ?? 'postgres://nobody:nobody@127.0.0.1:1/none';
    const env = parseEnv(process.env);
    webOrigin = env.WEB_ORIGIN;

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

  it('CORS не отражает чужой origin и отвечает только WEB_ORIGIN', async () => {
    const alien = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { origin: 'https://evil.example' },
    });
    const allow = alien.headers.get('access-control-allow-origin');
    // ACAO фиксирован значением WEB_ORIGIN (не отражает запрос): браузер
    // сопоставит его с evil.example и не даст прочитать ответ кук-домена.
    expect(allow).not.toBeNull();
    expect(allow).not.toBe('https://evil.example');

    const own = await fetch(`${baseUrl}/api/v1/me`, { headers: { origin: webOrigin } });
    expect(own.headers.get('access-control-allow-origin')).toBe(webOrigin);
  });

  it('nginx-конфиг держит строгий CSP: без inline-скриптов, стилей и внешних источников', () => {
    const conf = readFileSync(resolve(__dirname, '../../../docker/nginx/default.conf'), 'utf8');

    expect(conf).toContain("default-src 'self'");
    expect(conf).toContain("script-src 'self'");
    expect(conf).toContain("style-src 'self'");
    expect(conf).toContain("img-src 'self'");
    expect(conf).toContain("font-src 'self'");
    expect(conf).toContain("connect-src 'self'");
    expect(conf).toContain("frame-ancestors 'none'");
    expect(conf).toContain('X-Content-Type-Options nosniff always');
    expect(conf).not.toContain('unsafe-inline');
    expect(conf).not.toContain('https://');
  });

  it('index.html подключает локальные шрифты и не ссылается на внешние CDN', () => {
    const html = readFileSync(resolve(__dirname, '../../../apps/web/index.html'), 'utf8');

    expect(html).toContain('/fonts/fonts.css');
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('fonts.gstatic.com');
  });
});
