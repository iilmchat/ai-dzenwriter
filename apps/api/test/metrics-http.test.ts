import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ARTICLES_REPOSITORY } from '../src/articles/articles.repository';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { GITHUB_OAUTH } from '../src/auth/github.client';
import { createOpaqueToken, hashSessionToken } from '../src/auth/session-token';
import { CATALOG_REPOSITORY } from '../src/catalog/catalog.repository';
import { parseEnv, type Env } from '../src/config/env';
import { ENV } from '../src/config/tokens';
import { FACTS_REPOSITORY } from '../src/facts/facts.repository';
import { GENERATION_REPOSITORY } from '../src/generation/generation.repository';
import { LLM_PROVIDER } from '../src/generation/llm-provider';
import { MockLlmProvider } from '../src/generation/mock-provider';
import { IDENTITY_REPOSITORY } from '../src/identity/identity.repository';
import { METRICS_REPOSITORY } from '../src/metrics/metrics.repository';
import { PUBLICATIONS_REPOSITORY } from '../src/publications/publications.repository';
import { FakeGithubOAuth } from './support/fake-github';
import { InMemoryArticlesRepository } from './support/in-memory-articles.repository';
import { InMemoryCatalog } from './support/in-memory-catalog';
import { InMemoryFactsRepository } from './support/in-memory-facts.repository';
import { InMemoryGenerationRepository } from './support/in-memory-generation.repository';
import { InMemoryIdentityRepository } from './support/in-memory-identity.repository';
import { InMemoryMetricsRepository } from './support/in-memory-metrics.repository';
import { InMemoryPublicationsRepository } from './support/in-memory-publications.repository';

const WEB_ORIGIN = 'http://localhost:8080';

describe('метрики по HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  let identity: InMemoryIdentityRepository;
  let articles: InMemoryArticlesRepository;
  let metrics: InMemoryMetricsRepository;
  const tokens: Record<'author' | 'stranger', string> = { author: '', stranger: '' };
  let articleId = '';

  beforeAll(async () => {
    const env: Env = parseEnv({
      DATABASE_URL: 'postgres://nobody:nobody@127.0.0.1:1/none',
      WEB_ORIGIN,
      GITHUB_CLIENT_ID: 'client-id',
      GITHUB_CLIENT_SECRET: 'client-secret',
    });
    identity = new InMemoryIdentityRepository();
    const facts = new InMemoryFactsRepository();
    articles = new InMemoryArticlesRepository(facts);
    metrics = new InMemoryMetricsRepository();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ENV)
      .useValue(env)
      .overrideProvider(GITHUB_OAUTH)
      .useValue(new FakeGithubOAuth())
      .overrideProvider(IDENTITY_REPOSITORY)
      .useValue(identity)
      .overrideProvider(FACTS_REPOSITORY)
      .useValue(facts)
      .overrideProvider(ARTICLES_REPOSITORY)
      .useValue(articles)
      .overrideProvider(CATALOG_REPOSITORY)
      .useValue(new InMemoryCatalog())
      .overrideProvider(GENERATION_REPOSITORY)
      .useValue(new InMemoryGenerationRepository())
      .overrideProvider(LLM_PROVIDER)
      .useValue(new MockLlmProvider())
      .overrideProvider(PUBLICATIONS_REPOSITORY)
      .useValue(new InMemoryPublicationsRepository())
      .overrideProvider(METRICS_REPOSITORY)
      .useValue(metrics)
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app, env, pino({ level: 'silent' }));
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') {
      throw new Error('Сервер не получил порт');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;

    const owner = identity.addUser({ githubId: 8101, login: 'anna', role: 'author' });
    facts.people.set(owner.id, { id: owner.id, login: 'anna', name: null });
    articles.people.set(owner.id, { id: owner.id, login: 'anna', name: null });
    tokens.author = await sessionFor(owner.id);
    tokens.stranger = await sessionFor(
      identity.addUser({ githubId: 8102, login: 'vera', role: 'author' }).id,
    );

    articleId = await articles.insertArticle({
      topic: 'Кейс про ИИ',
      keywords: ['ИИ'],
      styleId: 'company-achievements',
      format: 'case',
      tone: 'neutral',
      lengthMin: 8000,
      lengthMax: 12000,
      productId: null,
      plannedAt: null,
      ownerId: owner.id,
    });
    metrics.addPublication({
      id: 'publication-1',
      articleId,
      externalUrl: 'https://dzen.ru/a/demo',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  async function sessionFor(userId: string): Promise<string> {
    const token = createOpaqueToken();
    await identity.insertSession({
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    return token;
  }

  async function call(
    method: string,
    path: string,
    as?: keyof typeof tokens,
    body?: unknown,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const headers: Record<string, string> = {};
    if (as) {
      headers.Cookie = `dzw_session=${tokens[as]}`;
    }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(`${baseUrl}/api/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text.length > 0 ? JSON.parse(text) : {} };
  }

  it('автор вносит метрики вручную', async () => {
    const response = await call('POST', '/metrics', 'author', {
      articleId,
      capturedOn: '2026-11-01',
      views: 1200,
      reads: 340,
      avgReadSeconds: 95,
    });

    expect(response.status).toBe(201);
    expect(response.body.snapshot).toMatchObject({ views: 1200, source: 'manual' });
  });

  it('список метрик отдаёт внесённое', async () => {
    const response = await call('GET', '/metrics', 'author');

    expect(response.status).toBe(200);
    const body = response.body as { items: { views: number }[] };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0]?.views).toBe(1200);
  });

  it('чужой пользователь получает 403', async () => {
    const response = await call('POST', '/metrics', 'stranger', {
      articleId,
      capturedOn: '2026-11-02',
      views: 10,
      reads: 2,
    });

    expect(response.status).toBe(403);
  });

  it('без входа метрики не вносятся', async () => {
    const response = await call('POST', '/metrics', undefined, {
      articleId,
      capturedOn: '2026-11-02',
      views: 10,
      reads: 2,
    });

    expect(response.status).toBe(401);
  });

  it('импорт CSV отвечает разбором файла', async () => {
    const response = await call('POST', '/metrics/import', 'author', {
      csv: [
        'url,captured_on,views,reads',
        'https://dzen.ru/a/demo,2026-11-03,1500,450',
        'https://dzen.ru/a/none,2026-11-03,10,2',
      ].join('\n'),
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ imported: 1, updated: 0 });
  });

  it('некорректная дата отклоняется', async () => {
    const response = await call('POST', '/metrics', 'author', {
      articleId,
      capturedOn: 'вчера',
      views: 10,
      reads: 2,
    });

    expect(response.status).toBe(400);
  });
});
