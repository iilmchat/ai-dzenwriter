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
import { IDENTITY_REPOSITORY } from '../src/identity/identity.repository';
import { FakeGithubOAuth } from './support/fake-github';
import { InMemoryArticlesRepository } from './support/in-memory-articles.repository';
import { InMemoryCatalog } from './support/in-memory-catalog';
import { InMemoryFactsRepository } from './support/in-memory-facts.repository';
import { InMemoryIdentityRepository } from './support/in-memory-identity.repository';

const WEB_ORIGIN = 'http://localhost:8080';
const SOURCE = { sourceUrl: 'https://example.com/news/1', sourcePublishedAt: '2026-10-20' };

interface Json {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

describe('факты и продукты по HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  let identity: InMemoryIdentityRepository;
  let facts: InMemoryFactsRepository;
  let nextGithubId = 5001;
  const tokens: Record<'author' | 'reviewer' | 'admin', string> = {
    author: '',
    reviewer: '',
    admin: '',
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
    const catalog = new InMemoryCatalog();
    const articles = new InMemoryArticlesRepository(facts);

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
    tokens.admin = await signIn('chief', 'admin');
  });

  afterAll(async () => {
    await app.close();
  });

  // Пользователь с ролью и сессией: токен кладём в cookie, как после входа через GitHub.
  async function signIn(login: string, role: UserRole): Promise<string> {
    const user = identity.addUser({ githubId: nextGithubId++, login, role });
    facts.people.set(user.id, { id: user.id, login, name: null });
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
  ): Promise<Json> {
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
    return {
      status: response.status,
      body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
    };
  }

  it('без входа библиотека фактов закрыта', async () => {
    const response = await call('GET', '/facts');

    expect(response.status).toBe(401);
  });

  it('где используется: без входа 401, для привязанного факта — материалы', async () => {
    const created = await call('POST', '/facts', 'author', {
      type: 'company_fact',
      text: 'Команда измеряет точность ответов',
    });
    const id = String(created.body.id);
    const articleId = '00000000-0000-4000-8000-00000000a1';
    facts.addUsage(id, {
      articleId,
      topic: 'Агенты на длинных задачах',
      status: 'in_review',
      updatedAt: new Date('2026-10-21T10:00:00Z'),
    });

    const anonymous = await call('GET', `/facts/${id}/usage`);
    expect(anonymous.status).toBe(401);

    const response = await call('GET', `/facts/${id}/usage`, 'author');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      items: [
        {
          articleId,
          topic: 'Агенты на длинных задачах',
          status: 'in_review',
        },
      ],
      truncated: false,
    });
  });

  it('где используется: неизвестный факт — 404 с понятным текстом', async () => {
    const response = await call(
      'GET',
      '/facts/00000000-0000-4000-8000-0000000000f1/usage',
      'author',
    );

    expect(response.status).toBe(404);
  });

  it('новость без ссылки отклоняется с понятным текстом', async () => {
    const response = await call('POST', '/facts', 'author', {
      type: 'news_source',
      text: 'Цитата',
    });

    expect(response.status).toBe(400);
    expect(String(response.body.detail)).toContain('ссылку на материал');
  });

  it('новость с источником — черновик, одобрение автору закрыто с причиной', async () => {
    const response = await call('POST', '/facts', 'author', {
      type: 'news_source',
      text: 'Цитата из статьи',
      ...SOURCE,
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      status: 'draft',
      createdBy: { login: 'anna' },
      actions: { approve: { allowed: false } },
    });
    expect(
      String((response.body.actions as { approve: { reason: string } }).approve.reason),
    ).toMatch(/ревьюер/);
  });

  it('автор не одобряет свой факт, ревьюер одобряет', async () => {
    const created = await call('POST', '/facts', 'author', {
      type: 'company_fact',
      text: 'Команда измеряет точность ответов',
    });
    const id = String(created.body.id);

    const forbidden = await call('POST', `/facts/${id}/approve`, 'author', { expectedVersion: 1 });
    expect(forbidden.status).toBe(403);

    const approved = await call('POST', `/facts/${id}/approve`, 'reviewer', { expectedVersion: 1 });
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ status: 'approved', approvedBy: { login: 'boris' } });
  });

  it('одобренный факт не правится: 409, исправление создаётся новым фактом', async () => {
    const created = await call('POST', '/facts', 'author', {
      type: 'news_source',
      text: 'Исходная цитата',
      ...SOURCE,
    });
    const id = String(created.body.id);
    await call('POST', `/facts/${id}/approve`, 'reviewer', { expectedVersion: 1 });

    const edit = await call('PATCH', `/facts/${id}`, 'author', {
      expectedVersion: 2,
      text: 'Правка',
    });
    expect(edit.status).toBe(409);
    expect(String(edit.body.detail)).toContain('новым фактом');

    const correction = await call('POST', `/facts/${id}/corrections`, 'author', {
      text: 'Уточнённая цитата',
      ...SOURCE,
    });
    expect(correction.status).toBe(201);
    expect(correction.body).toMatchObject({ status: 'draft', supersedesId: id });
  });

  it('устаревшая версия при одобрении отклоняется с конфликтом', async () => {
    const created = await call('POST', '/facts', 'author', {
      type: 'company_fact',
      text: 'Факт компании',
    });

    const stale = await call('POST', `/facts/${created.body.id}/approve`, 'reviewer', {
      expectedVersion: 99,
    });

    expect(stale.status).toBe(409);
  });

  it('создавать продукты может только администратор', async () => {
    const body = { slug: 'demo-product', name: 'Демо-продукт', oneLiner: 'Пример' };

    const forbidden = await call('POST', '/products', 'author', body);
    expect(forbidden.status).toBe(403);

    const created = await call('POST', '/products', 'admin', body);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ slug: 'demo-product', archived: false });

    const duplicate = await call('POST', '/products', 'admin', body);
    expect(duplicate.status).toBe(409);
  });

  it('некорректный идентификатор в пути объясняется по-русски', async () => {
    const response = await call('PATCH', '/facts/not-a-uuid', 'author', {
      expectedVersion: 1,
      text: 'Текст',
    });

    expect(response.status).toBe(400);
    expect(response.body.detail).toBe('Некорректный идентификатор факта');
  });
});
