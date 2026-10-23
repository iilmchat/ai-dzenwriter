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
import { PILOT_REPOSITORY } from '../src/pilot/pilot.repository';
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

describe('показатели пилота по HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  let identity: InMemoryIdentityRepository;
  const tokens: Record<'author' | 'admin', string> = { author: '', admin: '' };

  beforeAll(async () => {
    const env: Env = parseEnv({
      DATABASE_URL: 'postgres://nobody:nobody@127.0.0.1:1/none',
      WEB_ORIGIN,
      GITHUB_CLIENT_ID: 'client-id',
      GITHUB_CLIENT_SECRET: 'client-secret',
    });
    identity = new InMemoryIdentityRepository();
    const facts = new InMemoryFactsRepository();
    const articles = new InMemoryArticlesRepository(facts);
    const emptyPilot = {
      load: async () => ({ articles: [], versions: [], reviews: [], generationRuns: [] }),
    };

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
      .useValue(new InMemoryMetricsRepository())
      .overrideProvider(PILOT_REPOSITORY)
      .useValue(emptyPilot)
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app, env, pino({ level: 'silent' }));
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') {
      throw new Error('Сервер не получил порт');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;

    tokens.author = await sessionFor(identity.addUser({ githubId: 8201, login: 'anna' }).id);
    tokens.admin = await sessionFor(
      identity.addUser({ githubId: 8202, login: 'admin', role: 'admin' }).id,
    );
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
    path: string,
    as?: keyof typeof tokens,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const headers: Record<string, string> = {};
    if (as) {
      headers.Cookie = `dzw_session=${tokens[as]}`;
    }
    const response = await fetch(`${baseUrl}/api/v1${path}`, { headers });
    const text = await response.text();
    return { status: response.status, body: text.length > 0 ? JSON.parse(text) : {} };
  }

  it('без входа отчёт недоступен', async () => {
    expect((await call('/pilot/metrics')).status).toBe(401);
  });

  it('автор не видит показатели пилота', async () => {
    expect((await call('/pilot/metrics', 'author')).status).toBe(403);
  });

  it('администратор получает отчёт', async () => {
    const response = await call('/pilot/metrics', 'admin');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      articles: { total: 0, approved: 0 },
      generation: { runs: 0, costUsd: 0 },
    });
  });

  it('перевёрнутый период отклоняется', async () => {
    const response = await call('/pilot/metrics?from=2026-10-10&to=2026-10-01', 'admin');

    expect(response.status).toBe(400);
  });
});
