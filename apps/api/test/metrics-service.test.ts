import { describe, expect, it } from 'vitest';
import { MetricsService } from '../src/metrics/metrics.service';
import { InMemoryArticlesRepository } from './support/in-memory-articles.repository';
import { InMemoryFactsRepository } from './support/in-memory-facts.repository';
import { InMemoryMetricsRepository } from './support/in-memory-metrics.repository';

function setup() {
  const facts = new InMemoryFactsRepository();
  const articles = new InMemoryArticlesRepository(facts);
  const metrics = new InMemoryMetricsRepository();
  const service = new MetricsService(metrics, articles);

  const addPerson = (login: string) => {
    const person = articles.addPerson(login);
    facts.people.set(person.id, person);
    return person;
  };
  const owner = addPerson('anna');
  const stranger = addPerson('vera');
  const admin = addPerson('chief');
  const actors = {
    owner: { id: owner.id, role: 'author' as const },
    stranger: { id: stranger.id, role: 'author' as const },
    admin: { id: admin.id, role: 'admin' as const },
  };
  return { articles, metrics, service, actors };
}

type Harness = ReturnType<typeof setup>;

async function publishedArticle(harness: Harness): Promise<string> {
  const articleId = await harness.articles.insertArticle({
    topic: 'Кейс про ИИ',
    keywords: ['ИИ'],
    styleId: 'company-achievements',
    format: 'case',
    tone: 'neutral',
    lengthMin: 8000,
    lengthMax: 12000,
    productId: null,
    plannedAt: null,
    ownerId: harness.actors.owner.id,
  });
  harness.metrics.addPublication({
    id: 'publication-1',
    articleId,
    externalUrl: 'https://dzen.ru/a/demo',
  });
  return articleId;
}

describe('ручной ввод метрик', () => {
  it('автор вносит снимок по дате', async () => {
    const harness = setup();
    const articleId = await publishedArticle(harness);

    const response = await harness.service.create(harness.actors.owner, {
      articleId,
      capturedOn: '2026-11-01',
      views: 1200,
      reads: 340,
      avgReadSeconds: 95,
    });

    expect(response.snapshot).toMatchObject({
      articleId,
      capturedOn: '2026-11-01',
      views: 1200,
      reads: 340,
      source: 'manual',
    });
    expect(harness.metrics.audit.at(-1)).toMatchObject({ action: 'metric.create' });
  });

  it('повторный ввод на ту же дату обновляет снимок', async () => {
    const harness = setup();
    const articleId = await publishedArticle(harness);

    await harness.service.create(harness.actors.owner, {
      articleId,
      capturedOn: '2026-11-01',
      views: 100,
      reads: 20,
    });
    await harness.service.create(harness.actors.owner, {
      articleId,
      capturedOn: '2026-11-01',
      views: 250,
      reads: 60,
    });

    expect(harness.metrics.snapshots).toHaveLength(1);
    expect(harness.metrics.snapshots[0]).toMatchObject({ views: 250, reads: 60 });
  });

  it('чужой пользователь не вносит метрики', async () => {
    const harness = setup();
    const articleId = await publishedArticle(harness);

    await expect(
      harness.service.create(harness.actors.stranger, {
        articleId,
        capturedOn: '2026-11-01',
        views: 10,
        reads: 2,
      }),
    ).rejects.toThrow(/автор материала или администратор/);
  });

  it('администратор вносит метрики любого материала', async () => {
    const harness = setup();
    const articleId = await publishedArticle(harness);

    const response = await harness.service.create(harness.actors.admin, {
      articleId,
      capturedOn: '2026-11-01',
      views: 10,
      reads: 2,
    });

    expect(response.snapshot.views).toBe(10);
  });

  it('неопубликованному материалу метрики не идут', async () => {
    const harness = setup();
    const articleId = await harness.articles.insertArticle({
      topic: 'Кейс про ИИ',
      keywords: ['ИИ'],
      styleId: 'company-achievements',
      format: 'case',
      tone: 'neutral',
      lengthMin: 8000,
      lengthMax: 12000,
      productId: null,
      plannedAt: null,
      ownerId: harness.actors.owner.id,
    });

    await expect(
      harness.service.create(harness.actors.owner, {
        articleId,
        capturedOn: '2026-11-01',
        views: 10,
        reads: 2,
      }),
    ).rejects.toThrow(/только у опубликованного материала/);
  });
});

describe('импорт CSV метрик', () => {
  const CSV = [
    'url,captured_on,views,reads,avg_read_seconds',
    'https://dzen.ru/a/demo,2026-11-01,1200,340,95',
    'https://dzen.ru/a/unknown,2026-11-01,10,2,',
  ].join('\n');

  it('импортирует известные публикации и пропускает неизвестные', async () => {
    const harness = setup();
    await publishedArticle(harness);

    const response = await harness.service.importCsv(harness.actors.owner, CSV);

    expect(response.imported).toBe(1);
    expect(response.updated).toBe(0);
    expect(response.skipped).toHaveLength(1);
    expect(response.skipped[0]?.reason).toContain('Нет публикации');
    expect(harness.metrics.snapshots[0]).toMatchObject({
      capturedOn: '2026-11-01',
      views: 1200,
      source: 'csv',
    });
  });

  it('повторный импорт обновляет снимок, а не плодит строки', async () => {
    const harness = setup();
    await publishedArticle(harness);

    await harness.service.importCsv(harness.actors.owner, CSV);
    const response = await harness.service.importCsv(harness.actors.owner, CSV);

    expect(response.imported).toBe(0);
    expect(response.updated).toBe(1);
    expect(harness.metrics.snapshots).toHaveLength(1);
  });

  it('чужие материалы в импорте пропускаются', async () => {
    const harness = setup();
    await publishedArticle(harness);

    const response = await harness.service.importCsv(harness.actors.stranger, CSV);

    expect(response.imported).toBe(0);
    expect(response.skipped[0]?.reason).toContain('Нет доступа');
  });

  it('пустой файл не считается ошибкой', async () => {
    const harness = setup();

    const response = await harness.service.importCsv(harness.actors.owner, '');

    expect(response.imported).toBe(0);
    expect(response.skipped).toHaveLength(1);
  });
});

describe('список метрик', () => {
  it('отдаёт снимки по материалу', async () => {
    const harness = setup();
    const articleId = await publishedArticle(harness);
    await harness.service.create(harness.actors.owner, {
      articleId,
      capturedOn: '2026-11-01',
      views: 10,
      reads: 2,
    });

    const response = await harness.service.list(harness.actors.owner, { articleId });

    expect(response.items).toHaveLength(1);
    expect(response.items[0]?.views).toBe(10);
  });
});
