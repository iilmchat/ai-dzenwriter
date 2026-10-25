import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { unzipSync } from 'fflate';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GITHUB_OAUTH } from '../src/auth/github.client';
import { createOpaqueToken, hashSessionToken } from '../src/auth/session-token';
import { ARTICLES_REPOSITORY } from '../src/articles/articles.repository';
import { AUDIT_REPOSITORY } from '../src/audit/audit.repository';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
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

describe('скачивание пакета для Дзена по HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  let identity: InMemoryIdentityRepository;
  let audit: InMemoryAuditRepository;
  let articles: InMemoryArticlesRepository;
  let publications: InMemoryPublicationsRepository;
  const tokens: Record<'admin' | 'author', string> = { admin: '', author: '' };
  const ids: Record<'admin' | 'author', string> = { admin: '', author: '' };
  let approvedId = '';
  let draftId = '';

  beforeAll(async () => {
    const env: Env = parseEnv({
      DATABASE_URL: 'postgres://nobody:nobody@127.0.0.1:1/none',
      WEB_ORIGIN,
      GITHUB_CLIENT_ID: 'client-id',
      GITHUB_CLIENT_SECRET: 'client-secret',
    });
    identity = new InMemoryIdentityRepository();
    audit = new InMemoryAuditRepository();
    articles = new InMemoryArticlesRepository(new InMemoryFactsRepository());
    // Скачивания пакета пишутся в тот же журнал, который читает /audit.
    publications = new InMemoryPublicationsRepository((record) => {
      audit.addEntry({
        actorId: record.actorId,
        action: record.action,
        entityType: record.entityType,
        entityId: record.entityId,
        payload: record.payload,
      });
    });

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
      .useValue(articles)
      .overrideProvider(CATALOG_REPOSITORY)
      .useValue(new InMemoryCatalog())
      .overrideProvider(GENERATION_REPOSITORY)
      .useValue(new InMemoryGenerationRepository())
      .overrideProvider(LLM_PROVIDER)
      .useValue(new MockLlmProvider())
      .overrideProvider(PUBLICATIONS_REPOSITORY)
      .useValue(publications)
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

    // Утверждённый материал с версией текста: пакет для него готов.
    const authorPerson = articles.addPerson('boris');
    approvedId = await articles.insertArticle({
      topic: 'Как мы проверяем факты',
      keywords: ['ии', 'факты'],
      styleId: 'company-achievements',
      format: 'article',
      tone: 'neutral',
      lengthMin: 6000,
      lengthMax: 8000,
      productId: null,
      plannedAt: null,
      ownerId: authorPerson.id,
    });
    await articles.insertVersion(
      {
        articleId: approvedId,
        origin: 'manual',
        title: 'Как мы проверяем факты',
        articleMarkdown:
          'Вступление.\n\nОсновная часть: [Reuters](https://reuters.com/news) о переносе.',
        seoTitle: 'Проверка фактов в конвейере',
        tags: ['ии', 'практика'],
        description: 'Как мы проверяем факты в конвейере.',
        imagePrompt: 'Спокойная иллюстрация: экран с кодом.',
        advertisingLabel: false,
        disclaimerText: null,
        claims: [],
        checks: [],
        styleVersion: 1,
        promptVersion: 'sha256:abc',
        generationRunId: null,
        createdBy: authorPerson.id,
      },
      new Date(),
    );
    articles.setStatus(approvedId, 'approved', { ownerId: authorPerson.id });
    publications.add({
      articleId: approvedId,
      topic: 'Как мы проверяем факты',
      styleId: 'company-achievements',
      status: 'approved',
      version: 2,
      currentVersionNumber: 1,
      plannedAt: null,
      publishedAt: null,
      externalUrl: null,
    });

    // Черновик: пакет не готов.
    draftId = await articles.insertArticle({
      topic: 'Черновик без версии',
      keywords: [],
      styleId: 'company-achievements',
      format: 'article',
      tone: 'neutral',
      lengthMin: 6000,
      lengthMax: 8000,
      productId: null,
      plannedAt: null,
      ownerId: authorPerson.id,
    });
    articles.setStatus(draftId, 'drafting', { ownerId: authorPerson.id });
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

  function cookie(as: keyof typeof tokens): string {
    return `dzw_session=${tokens[as]}`;
  }

  it('список публикаций отдаёт материалы в публикации', async () => {
    const response = await fetch(`${baseUrl}/api/v1/publications`, {
      headers: { Cookie: cookie('author') },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: { articleId: string; canExport: boolean }[];
    };
    const item = body.items.find((entry) => entry.articleId === approvedId);
    expect(item).toMatchObject({ articleId: approvedId, canExport: true });
  });

  it('без входа список публикаций не отдаётся', async () => {
    const response = await fetch(`${baseUrl}/api/v1/publications`);
    expect(response.status).toBe(401);
  });

  it('пакет скачивается и скачивание пишется в журнал', async () => {
    const response = await fetch(`${baseUrl}/api/v1/publications/${approvedId}/export`, {
      headers: { Cookie: cookie('author') },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(response.headers.get('content-disposition')).toContain('dzenwriter-');
    const bytes = new Uint8Array(await response.arrayBuffer());
    // Магия zip: пакет начинается с «PK».
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    // Состав пакета и текст проверяются по распаковке, как в E9.
    const files = unzipSync(new Uint8Array(bytes));
    expect(Object.keys(files).sort()).toEqual([
      'article.md',
      'checklist.md',
      'image_prompt.txt',
      'metadata.json',
    ]);
    const article = new TextDecoder().decode(files['article.md']);
    expect(article).toContain('# Как мы проверяем факты');
    expect(article).toContain('SEO_TITLE: Проверка фактов в конвейере');

    const records = publications.audit.filter(
      (record) => record.entityId === approvedId && record.action === 'article.package_download',
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      actorId: ids.author,
      action: 'article.package_download',
      entityType: 'article',
      entityId: approvedId,
      payload: {
        version: 1,
        files: ['article.md', 'metadata.json', 'image_prompt.txt', 'checklist.md'],
      },
    });
  });

  it('без входа пакет не отдаётся', async () => {
    const response = await fetch(`${baseUrl}/api/v1/publications/${approvedId}/export`);
    expect(response.status).toBe(401);
    expect(publications.audit).toHaveLength(1);
  });

  it('черновик пакета не получает: сначала ревью', async () => {
    const response = await fetch(`${baseUrl}/api/v1/publications/${draftId}/export`, {
      headers: { Cookie: cookie('author') },
    });
    expect(response.status).toBe(409);
    expect(publications.audit).toHaveLength(1);
  });

  it('скачивание видно в журнале по сквозному фильтру', async () => {
    const response = await fetch(
      `${baseUrl}/api/v1/audit?action=${encodeURIComponent('article.package_download')}`,
      { headers: { Cookie: cookie('admin') } },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: { action: string; entityType: string; entityId: string; actorId: string | null }[];
    };
    const downloads = body.items.filter((item) => item.entityId === approvedId);
    expect(downloads).toHaveLength(1);
    expect(downloads[0]).toMatchObject({
      action: 'article.package_download',
      entityType: 'article',
      actorId: ids.author,
    });
  });
});
