import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { UserRole } from '@dzenwriter/shared';
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
import { FakeGithubOAuth } from './support/fake-github';
import { InMemoryArticlesRepository } from './support/in-memory-articles.repository';
import { InMemoryCatalog } from './support/in-memory-catalog';
import { InMemoryFactsRepository } from './support/in-memory-facts.repository';
import { InMemoryGenerationRepository } from './support/in-memory-generation.repository';
import { InMemoryIdentityRepository } from './support/in-memory-identity.repository';

const WEB_ORIGIN = 'http://localhost:8080';
const NOW = new Date('2026-10-22T10:00:00Z');

const BLOCKING = {
  id: 'numbers_must_map_to_facts',
  severity: 'block' as const,
  message: '«42» не найдено в фактах',
  start: 10,
  end: 12,
  excerpt: '42',
};

describe('подтверждение проверок по HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  let identity: InMemoryIdentityRepository;
  let facts: InMemoryFactsRepository;
  let articles: InMemoryArticlesRepository;
  let nextGithubId = 9001;
  const tokens: Record<'author' | 'stranger', string> = { author: '', stranger: '' };

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
      .useValue(new InMemoryGenerationRepository())
      .overrideProvider(LLM_PROVIDER)
      .useValue(new MockLlmProvider())
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

  async function articleWithCheck(): Promise<string> {
    const owner = [...articles.people.values()].find((person) => person.login === 'anna');
    if (!owner) {
      throw new Error('Нет автора');
    }
    const id = await articles.insertArticle({
      topic: 'Регулирование ИИ в Европейском союзе',
      keywords: ['ИИ'],
      styleId: 'industry-news',
      format: 'news',
      tone: 'neutral',
      lengthMin: 4000,
      lengthMax: 6000,
      productId: null,
      plannedAt: null,
      ownerId: owner.id,
    });
    await articles.insertVersion(
      {
        articleId: id,
        origin: 'generated',
        title: 'Заголовок',
        articleMarkdown: 'В тексте есть число 42.',
        seoTitle: 'SEO',
        tags: ['ии'],
        description: 'Описание',
        imagePrompt: 'Обложка',
        advertisingLabel: false,
        disclaimerText: null,
        claims: [],
        checks: [BLOCKING],
        styleVersion: 1,
        promptVersion: 'sha256:test',
        generationRunId: null,
        createdBy: owner.id,
      },
      NOW,
    );
    return id;
  }

  it('без входа подтверждение не проходит', async () => {
    const articleId = await articleWithCheck();

    const response = await call(
      'POST',
      `/articles/${articleId}/versions/1/checks/0/confirm`,
      undefined,
      { comment: 'Это номер пункта правил.' },
    );

    expect(response.status).toBe(401);
  });

  it('автор подтверждает проверку с комментарием', async () => {
    const articleId = await articleWithCheck();

    const response = await call(
      'POST',
      `/articles/${articleId}/versions/1/checks/0/confirm`,
      'author',
      { comment: 'Это номер пункта правил.' },
    );

    expect(response.status).toBe(200);
    const checks = (response.body.checks ?? []) as Record<string, unknown>[];
    expect(checks[0]).toMatchObject({
      id: 'numbers_must_map_to_facts',
      decision: 'confirmed',
      comment: 'Это номер пункта правил.',
    });
  });

  it('без комментария подтверждение отклоняется', async () => {
    const articleId = await articleWithCheck();

    const response = await call(
      'POST',
      `/articles/${articleId}/versions/1/checks/0/confirm`,
      'author',
      { comment: '   ' },
    );

    expect(response.status).toBe(400);
  });

  it('чужой пользователь получает 403', async () => {
    const articleId = await articleWithCheck();

    const response = await call(
      'POST',
      `/articles/${articleId}/versions/1/checks/0/confirm`,
      'stranger',
      { comment: 'Это номер пункта правил.' },
    );

    expect(response.status).toBe(403);
  });

  it('несуществующая проверка отвечает 404', async () => {
    const articleId = await articleWithCheck();

    const response = await call(
      'POST',
      `/articles/${articleId}/versions/1/checks/5/confirm`,
      'author',
      { comment: 'Это номер пункта правил.' },
    );

    expect(response.status).toBe(404);
  });
});
