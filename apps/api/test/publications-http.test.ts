import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { unzipSync } from 'fflate';
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
import { PUBLICATIONS_REPOSITORY } from '../src/publications/publications.repository';
import { FakeGithubOAuth } from './support/fake-github';
import { InMemoryArticlesRepository } from './support/in-memory-articles.repository';
import { InMemoryCatalog } from './support/in-memory-catalog';
import { InMemoryFactsRepository } from './support/in-memory-facts.repository';
import { InMemoryGenerationRepository } from './support/in-memory-generation.repository';
import { InMemoryIdentityRepository } from './support/in-memory-identity.repository';
import { InMemoryPublicationsRepository } from './support/in-memory-publications.repository';

const WEB_ORIGIN = 'http://localhost:8080';
const NOW = new Date('2026-10-22T10:00:00Z');

describe('публикации и пакет для Дзена по HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  let identity: InMemoryIdentityRepository;
  let articles: InMemoryArticlesRepository;
  let publications: InMemoryPublicationsRepository;
  let token = '';
  let approvedArticleId = '';
  let draftArticleId = '';

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
    publications = new InMemoryPublicationsRepository();
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
      .overrideProvider(PUBLICATIONS_REPOSITORY)
      .useValue(publications)
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app, env, pino({ level: 'silent' }));
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') {
      throw new Error('Сервер не получил порт');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;

    const user = identity.addUser({ githubId: 8001, login: 'anna', role: 'author' });
    facts.people.set(user.id, { id: user.id, login: 'anna', name: null });
    articles.people.set(user.id, { id: user.id, login: 'anna', name: null });
    token = createOpaqueToken();
    await identity.insertSession({
      userId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    approvedArticleId = await articles.insertArticle({
      topic: 'Как мы перенесли проверку фактов',
      keywords: ['ии'],
      styleId: 'company-achievements',
      format: 'article',
      tone: 'neutral',
      lengthMin: 8000,
      lengthMax: 12000,
      productId: null,
      plannedAt: null,
      ownerId: user.id,
    });
    await articles.insertVersion(
      {
        articleId: approvedArticleId,
        origin: 'generated',
        title: 'Как мы перенесли проверку фактов',
        articleMarkdown: 'Вступление.\n\nОсновная часть.',
        seoTitle: 'Проверка фактов',
        tags: ['ии', 'практика'],
        description: 'Описание',
        imagePrompt: 'Обложка',
        advertisingLabel: false,
        disclaimerText: null,
        claims: [],
        checks: [],
        styleVersion: 1,
        promptVersion: 'sha256:test',
        generationRunId: null,
        createdBy: user.id,
      },
      NOW,
    );
    articles.setStatus(approvedArticleId, 'approved');
    publications.add({
      articleId: approvedArticleId,
      topic: 'Как мы перенесли проверку фактов',
      styleId: 'company-achievements',
      status: 'approved',
      version: 2,
      currentVersionNumber: 1,
      plannedAt: null,
      publishedAt: null,
      externalUrl: null,
    });

    draftArticleId = await articles.insertArticle({
      topic: 'Черновик без утверждения',
      keywords: ['ии'],
      styleId: 'company-achievements',
      format: 'article',
      tone: 'neutral',
      lengthMin: 8000,
      lengthMax: 12000,
      productId: null,
      plannedAt: null,
      ownerId: user.id,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  async function call(
    method: string,
    path: string,
    as?: boolean,
  ): Promise<{ status: number; body: Buffer; contentType: string | null }> {
    const headers: Record<string, string> = {};
    if (as === true) {
      headers.Cookie = `dzw_session=${token}`;
    }
    const response = await fetch(`${baseUrl}/api/v1${path}`, { method, headers });
    return {
      status: response.status,
      body: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type'),
    };
  }

  it('список публикаций отдаёт материалы в публикации', async () => {
    const response = await call('GET', '/publications', true);

    expect(response.status).toBe(200);
    const body = JSON.parse(response.body.toString('utf8')) as {
      items: { articleId: string; canExport: boolean }[];
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ articleId: approvedArticleId, canExport: true });
  });

  it('без входа список не отдаётся', async () => {
    const response = await call('GET', '/publications');

    expect(response.status).toBe(401);
  });

  it('пакет отдаётся zip с текстом, метаданными, промптом обложки и чек-листом', async () => {
    const response = await call('GET', `/publications/${approvedArticleId}/export`, true);

    expect(response.status).toBe(200);
    expect(response.contentType).toContain('application/zip');
    const files = unzipSync(new Uint8Array(response.body));
    const names = Object.keys(files).sort();
    expect(names).toEqual(['article.md', 'checklist.md', 'image_prompt.txt', 'metadata.json']);
    const article = new TextDecoder().decode(files['article.md']);
    expect(article).toContain('# Как мы перенесли проверку фактов');
    expect(article).toContain('SEO_TITLE: Проверка фактов');
  });

  it('неутверждённый материал пакет не готовит', async () => {
    const response = await call('GET', `/publications/${draftArticleId}/export`, true);

    expect(response.status).toBe(409);
  });

  it('без входа пакет не скачивается', async () => {
    const response = await call('GET', `/publications/${approvedArticleId}/export`);

    expect(response.status).toBe(401);
  });
});
