import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ARTICLES_REPOSITORY } from '../src/articles/articles.repository';
import { AUDIT_REPOSITORY } from '../src/audit/audit.repository';
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
import { InMemoryAuditRepository } from './support/in-memory-audit.repository';
import { InMemoryCatalog } from './support/in-memory-catalog';
import { InMemoryFactsRepository } from './support/in-memory-facts.repository';
import { InMemoryGenerationRepository } from './support/in-memory-generation.repository';
import { InMemoryIdentityRepository } from './support/in-memory-identity.repository';
import { InMemoryMetricsRepository } from './support/in-memory-metrics.repository';
import { InMemoryPublicationsRepository } from './support/in-memory-publications.repository';

const WEB_ORIGIN = 'http://localhost:8080';

describe('журнал аудита по HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  let identity: InMemoryIdentityRepository;
  let audit: InMemoryAuditRepository;
  const tokens: Record<'admin' | 'author', string> = { admin: '', author: '' };
  const ids: Record<'admin' | 'author', string> = { admin: '', author: '' };

  beforeAll(async () => {
    const env: Env = parseEnv({
      DATABASE_URL: 'postgres://nobody:nobody@127.0.0.1:1/none',
      WEB_ORIGIN,
      GITHUB_CLIENT_ID: 'client-id',
      GITHUB_CLIENT_SECRET: 'client-secret',
    });
    identity = new InMemoryIdentityRepository();
    audit = new InMemoryAuditRepository();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ENV)
      .useValue(env)
      .overrideProvider(GITHUB_OAUTH)
      .useValue(new FakeGithubOAuth())
      .overrideProvider(IDENTITY_REPOSITORY)
      .useValue(identity)
      .overrideProvider(FACTS_REPOSITORY)
      .useValue(new InMemoryFactsRepository())
      .overrideProvider(ARTICLES_REPOSITORY)
      .useValue(new InMemoryArticlesRepository(new InMemoryFactsRepository()))
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
      .overrideProvider(AUDIT_REPOSITORY)
      .useValue(audit)
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app, env, pino({ level: 'silent' }));
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') {
      throw new Error('Сервер не получил порт');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;

    const admin = identity.addUser({ githubId: 8201, login: 'anna', role: 'admin' });
    const author = identity.addUser({ githubId: 8202, login: 'boris', role: 'author' });
    ids.admin = admin.id;
    ids.author = author.id;
    tokens.admin = await sessionFor(admin.id);
    tokens.author = await sessionFor(author.id);

    audit.addEntry({
      actorId: author.id,
      actorLogin: 'boris',
      action: 'article.transition',
      entityType: 'article',
      entityId: '00000000-0000-4000-8000-00000000b001',
      payload: { from: 'drafting', to: 'in_review' },
      createdAt: new Date('2026-10-24T09:00:00.000Z'),
    });
    audit.addEntry({
      actorId: admin.id,
      actorLogin: 'anna',
      action: 'fact.create',
      entityType: 'fact',
      entityId: '00000000-0000-4000-8000-00000000f001',
      payload: { type: 'company_fact' },
      createdAt: new Date('2026-10-25T12:00:00.000Z'),
    });
    // Отказ во входе: исполнитель неизвестен.
    audit.addEntry({
      action: 'auth.denied',
      entityType: 'user',
      entityId: '',
      payload: { stateless: 'state' },
      createdAt: new Date('2026-10-23T15:30:00.000Z'),
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
    path: string,
    as?: keyof typeof tokens,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const headers: Record<string, string> = {};
    if (as) {
      headers.Cookie = `dzw_session=${tokens[as]}`;
    }
    const response = await fetch(`${baseUrl}/api/v1${path}`, { method: 'GET', headers });
    const text = await response.text();
    return { status: response.status, body: text.length > 0 ? JSON.parse(text) : {} };
  }

  it('администратор читает журнал: новые записи раньше старых', async () => {
    const response = await call('/audit', 'admin');

    expect(response.status).toBe(200);
    const body = response.body as {
      items: { action: string; actorLogin: string | null; createdAt: string }[];
      truncated: boolean;
    };
    expect(body.truncated).toBe(false);
    expect(body.items.map((item) => item.action)).toEqual([
      'fact.create',
      'article.transition',
      'auth.denied',
    ]);
    expect(body.items[0]?.actorLogin).toBe('anna');
    expect(body.items[2]?.actorLogin).toBeNull();
  });

  it('автор получает запрет роли', async () => {
    const response = await call('/audit', 'author');

    expect(response.status).toBe(403);
  });

  it('без входа журнал не отдаётся', async () => {
    const response = await call('/audit');

    expect(response.status).toBe(401);
  });

  it('фильтр по действию и сущности отбирает нужные записи', async () => {
    const byAction = await call('/audit?action=fact.create', 'admin');
    expect(byAction.status).toBe(200);
    const actions = (byAction.body as { items: { action: string }[] }).items;
    expect(actions).toHaveLength(1);
    expect(actions[0]?.action).toBe('fact.create');

    const byEntity = await call('/audit?entityType=article', 'admin');
    expect((byEntity.body as { items: unknown[] }).items).toHaveLength(1);
  });

  it('фильтр по периоду включает границы', async () => {
    const response = await call(
      '/audit?from=2026-10-24T00:00:00.000Z&to=2026-10-24T23:59:59.999Z',
      'admin',
    );

    expect(response.status).toBe(200);
    const actions = (response.body as { items: { action: string }[] }).items;
    expect(actions.map((item) => item.action)).toEqual(['article.transition']);
  });

  it('фильтр по исполнителю отбирает его записи', async () => {
    const response = await call(`/audit?actorId=${ids.author}`, 'admin');

    expect(response.status).toBe(200);
    const items = (response.body as { items: { actorLogin: string | null }[] }).items;
    expect(items).toHaveLength(1);
    expect(items[0]?.actorLogin).toBe('boris');
  });

  it('некорректные фильтры отклоняются', async () => {
    const badActor = await call('/audit?actorId=не-uuid', 'admin');
    expect(badActor.status).toBe(400);

    const badPeriod = await call(
      '/audit?from=2026-10-25T00:00:00.000Z&to=2026-10-24T23:59:59.999Z',
      'admin',
    );
    expect(badPeriod.status).toBe(400);
  });
});
