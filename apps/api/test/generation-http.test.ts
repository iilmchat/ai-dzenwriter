import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { UserRole } from '@dzenwriter/shared';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ArticlesService } from '../src/articles/articles.service';
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
import { FakeGithubOAuth } from './support/fake-github';
import { InMemoryArticlesRepository } from './support/in-memory-articles.repository';
import { InMemoryCatalog } from './support/in-memory-catalog';
import { InMemoryFactsRepository } from './support/in-memory-facts.repository';
import { InMemoryGenerationRepository } from './support/in-memory-generation.repository';
import { InMemoryIdentityRepository } from './support/in-memory-identity.repository';

const WEB_ORIGIN = 'http://localhost:8080';

interface SseEvent {
  readonly event: string;
  readonly data: Record<string, unknown>;
}

describe('генерация по HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  let identity: InMemoryIdentityRepository;
  let facts: InMemoryFactsRepository;
  let articles: InMemoryArticlesRepository;
  let runs: InMemoryGenerationRepository;
  let provider: MockLlmProvider;
  let nextGithubId = 7001;
  const tokens: Record<'author' | 'reviewer' | 'stranger', string> = {
    author: '',
    reviewer: '',
    stranger: '',
  };

  beforeAll(async () => {
    const env: Env = parseEnv({
      DATABASE_URL: 'postgres://nobody:nobody@127.0.0.1:1/none',
      WEB_ORIGIN,
      GITHUB_CLIENT_ID: 'client-id',
      GITHUB_CLIENT_SECRET: 'client-secret',
    });
    identity = new InMemoryIdentityRepository();
    facts = new InMemoryFactsRepository();
    articles = new InMemoryArticlesRepository(facts);
    runs = new InMemoryGenerationRepository();
    provider = new MockLlmProvider();
    const catalog = new InMemoryCatalog();

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
      .useValue(catalog)
      .overrideProvider(GENERATION_REPOSITORY)
      .useValue(runs)
      .overrideProvider(LLM_PROVIDER)
      .useValue(provider)
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app, env, pino({ level: 'silent' }));
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') {
      throw new Error('Сервер не получил порт');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;

    tokens.author = await signIn('anna', 'author');
    tokens.reviewer = await signIn('boris', 'reviewer');
    tokens.stranger = await signIn('vera', 'author');
  });

  afterAll(async () => {
    await app.close();
  });

  async function signIn(login: string, role: UserRole): Promise<string> {
    const user = identity.addUser({ githubId: nextGithubId++, login, role });
    facts.people.set(user.id, { id: user.id, login, name: null });
    articles.people.set(user.id, { id: user.id, login, name: null });
    const token = createOpaqueToken();
    await identity.insertSession({
      userId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    return token;
  }

  async function call(
    method: string,
    path: string,
    as?: keyof typeof tokens,
    extraHeaders?: Record<string, string>,
  ): Promise<{ status: number; contentType: string | null; body: string }> {
    const headers: Record<string, string> = { ...extraHeaders };
    if (as) {
      headers.Cookie = `dzw_session=${tokens[as]}`;
    }
    const response = await fetch(`${baseUrl}/api/v1${path}`, { method, headers });
    return {
      status: response.status,
      contentType: response.headers.get('content-type'),
      body: await response.text(),
    };
  }

  async function readyArticle(
    topic = 'Регулирование ИИ в ЕС осенью 2026 года',
    keywords: readonly string[] = ['ИИ'],
  ): Promise<string> {
    const service = app.get(ArticlesService);
    const ownerId = [...articles.people.values()].find((person) => person.login === 'anna')?.id;
    if (!ownerId) {
      throw new Error('Нет автора');
    }
    const created = await service.create(
      { id: ownerId, role: 'author' },
      { topic, keywords: [...keywords], styleId: 'industry-news', format: 'news' },
    );
    const fact = facts.addFact({
      type: 'news_source',
      text: 'Европейский союз принял пакет правил по ИИ.',
      sourceName: 'Reuters',
      sourceUrl: 'https://example.com/eu-ai-act',
      sourcePublishedAt: '2026-10-20',
      status: 'approved',
      createdById: ownerId,
    });
    await articles.attachFact(created.article.id, fact.id, ownerId);
    const totals = {
      news_source: { count: 1, chars: fact.text.length },
      company_fact: { count: 0, chars: 0 },
      product_fact: { count: 0, chars: 0 },
      experience_note: { count: 0, chars: 0 },
    };
    articles.setTotals(created.article.id, totals);
    return created.article.id;
  }

  function parseSse(body: string): SseEvent[] {
    const events: SseEvent[] = [];
    for (const block of body.split('\n\n')) {
      const lines = block.split('\n').filter((line) => line.length > 0);
      const name = lines.find((line) => line.startsWith('event: '))?.slice(7);
      const data = lines.find((line) => line.startsWith('data: '))?.slice(6);
      if (name !== undefined && data !== undefined) {
        events.push({ event: name, data: JSON.parse(data) as Record<string, unknown> });
      }
    }
    return events;
  }

  it('без входа запуск не проходит', async () => {
    const articleId = await readyArticle();

    const response = await call('POST', `/articles/${articleId}/generations`);

    expect(response.status).toBe(401);
    expect(response.contentType).toContain('application/problem+json');
  });

  it('чужой пользователь получает 403 до начала потока', async () => {
    const articleId = await readyArticle();

    const response = await call('POST', `/articles/${articleId}/generations`, 'stranger');

    expect(response.status).toBe(403);
    expect(response.contentType).toContain('application/problem+json');
  });

  it('запуск отдаёт поток SSE со стадиями и итогом', async () => {
    const articleId = await readyArticle();

    const response = await call('POST', `/articles/${articleId}/generations`, 'author');

    expect(response.status).toBe(200);
    expect(response.contentType).toContain('text/event-stream');
    const events = parseSse(response.body);
    const stages = events.filter((event) => event.event === 'stage');
    expect([
      ...new Set(stages.map((event) => (event.data.stage as { stage: string }).stage)),
    ]).toEqual(['prompt', 'generate', 'parse', 'checks']);
    const result = events.at(-1);
    expect(result?.event).toBe('result');
    expect((result?.data.result as { status: string }).status).toBe('succeeded');
  });

  it('повтор с тем же ключом идемпотентности не создаёт второй запуск', async () => {
    const articleId = await readyArticle();
    const before = provider.requests.length;

    const first = await call('POST', `/articles/${articleId}/generations`, 'author', {
      'Idempotency-Key': 'key-http-1',
    });
    const second = await call('POST', `/articles/${articleId}/generations`, 'author', {
      'Idempotency-Key': 'key-http-1',
    });

    const firstRun = parseSse(first.body).at(-1)?.data.result as { runId: string };
    const secondRun = parseSse(second.body).at(-1)?.data.result as { runId: string };
    expect(secondRun.runId).toBe(firstRun.runId);
    expect(provider.requests.length - before).toBe(1);
  });

  it('история запусков отдаётся списком', async () => {
    const articleId = await readyArticle();
    await call('POST', `/articles/${articleId}/generations`, 'author');

    const response = await call('GET', `/articles/${articleId}/generations`, 'author');

    expect(response.status).toBe(200);
    const body = JSON.parse(response.body) as { items: { status: string }[] };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0]?.status).toBe('succeeded');
  });

  it('отмена завершённого запуска отвечает 409', async () => {
    const articleId = await readyArticle();
    const started = await call('POST', `/articles/${articleId}/generations`, 'author');
    const runId = (parseSse(started.body).at(-1)?.data.result as { runId: string }).runId;

    const response = await call(
      'POST',
      `/articles/${articleId}/generations/${runId}/cancel`,
      'author',
    );

    expect(response.status).toBe(409);
  });

  it('подтверждение ревьюера на тему вне фокуса ИИ доступно ревьюеру', async () => {
    const articleId = await readyArticle('Рецепт борща и его история', ['суп']);

    const denied = await call('POST', `/articles/${articleId}/generation-confirmation`, 'author');
    expect(denied.status).toBe(403);

    const allowed = await call(
      'POST',
      `/articles/${articleId}/generation-confirmation`,
      'reviewer',
    );
    expect(allowed.status).toBe(200);
    const body = JSON.parse(allowed.body) as {
      generation: { confirmed: boolean; outOfFocus: boolean };
    };
    expect(body.generation.confirmed).toBe(true);
    expect(body.generation.outOfFocus).toBe(true);
  });
});
