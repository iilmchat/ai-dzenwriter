import path from 'node:path';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { CreateArticleInput } from '@dzenwriter/shared';
import { describe, expect, it } from 'vitest';
import { emptyFactTotals, OUT_OF_FOCUS_WARNING } from '../src/articles/article-rules';
import { ArticlesService } from '../src/articles/articles.service';
import { loadAppConfig, resolveConfigDir } from '../src/config/app-config';
import { ChecksService } from '../src/checks/checks.service';
import { InMemoryArticlesRepository } from './support/in-memory-articles.repository';
import { InMemoryCatalog } from './support/in-memory-catalog';
import { type StoredFact, InMemoryFactsRepository } from './support/in-memory-facts.repository';

const config = loadAppConfig(resolveConfigDir(path.resolve(process.cwd(), '../../config')));
const NOW = new Date('2026-10-22T10:00:00Z');
const PLAN = '2026-11-01T09:00:00.000Z';
const DZEN_URL = 'https://dzen.ru/a/demo-article';
const NEWS: CreateArticleInput = {
  topic: 'Новости о регулировании ИИ',
  keywords: ['ИИ'],
  styleId: 'industry-news',
  format: 'news',
};

function setup() {
  const facts = new InMemoryFactsRepository();
  const repo = new InMemoryArticlesRepository(facts);
  const catalog = new InMemoryCatalog();
  const service = new ArticlesService(repo, catalog, facts, new ChecksService(config), config);
  const addPerson = (login: string) => {
    const person = repo.addPerson(login);
    facts.people.set(person.id, person);
    return person;
  };
  const owner = addPerson('anna');
  const reviewer = addPerson('boris');
  const stranger = addPerson('vera');
  const admin = addPerson('chief');
  const actors = {
    owner: { id: owner.id, role: 'author' as const },
    reviewer: { id: reviewer.id, role: 'reviewer' as const },
    stranger: { id: stranger.id, role: 'author' as const },
    admin: { id: admin.id, role: 'admin' as const },
  };
  return { repo, facts, catalog, service, actors };
}

type Harness = ReturnType<typeof setup>;

async function createArticle(
  harness: Harness,
  overrides: Partial<CreateArticleInput> = {},
  actor = harness.actors.owner,
) {
  const response = await harness.service.create(actor, { ...NEWS, ...overrides });
  return response.article;
}

describe('ручное сохранение версии и откат', () => {
  async function articleWithFacts(harness: Harness) {
    const article = await createArticle(harness);
    const fact = harness.facts.addFact({
      type: 'news_source',
      text: 'Европейский союз принял пакет правил по ИИ.',
      sourceName: 'Reuters',
      sourceUrl: 'https://example.com/eu-ai-act',
      sourcePublishedAt: '2026-10-20',
      status: 'approved',
      createdById: harness.actors.owner.id,
    });
    await harness.repo.attachFact(article.id, fact.id, harness.actors.owner.id);
    const totals = emptyFactTotals();
    totals.news_source = { count: 1, chars: fact.text.length };
    harness.repo.setTotals(article.id, totals);
    return article;
  }

  const DRAFT = {
    title: 'Правленый заголовок',
    articleMarkdown: 'Европейский союз принял пакет правил по ИИ 42 раза.',
    seoTitle: 'Правленый SEO-заголовок',
    tags: ['ии', 'практика'],
    description: 'Описание',
    imagePrompt: 'Обложка',
    advertisingLabel: false,
    disclaimerText: null,
    claims: [
      {
        text: 'Европейский союз принял пакет правил по ИИ',
        type: 'fact' as const,
        factIds: ['F1'],
      },
    ],
  };

  it('автор сохраняет версию: проверки считаются, утверждения получают места', async () => {
    const harness = setup();
    const article = await articleWithFacts(harness);

    const response = await harness.service.saveVersion(
      harness.actors.owner,
      article.id,
      { ...DRAFT, expectedVersion: article.version },
      NOW,
    );

    expect(response.version.number).toBe(1);
    expect(response.version.origin).toBe('manual');
    expect(response.version.claims[0]?.start).toBe(0);
    expect(response.version.claims[0]?.end).toBeGreaterThan(0);
    // Числа 42 в фактах нет — это блокирующая проверка.
    expect(response.version.checks.map((item) => item.id)).toContain('numbers_must_map_to_facts');
    expect(harness.repo.audit.at(-1)).toMatchObject({ action: 'version.create' });
  });

  it('устаревшая версия материала даёт 409', async () => {
    const harness = setup();
    const article = await articleWithFacts(harness);

    await expect(
      harness.service.saveVersion(
        harness.actors.owner,
        article.id,
        { ...DRAFT, expectedVersion: article.version + 5 },
        NOW,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('чужой пользователь не сохраняет версию', async () => {
    const harness = setup();
    const article = await articleWithFacts(harness);

    await expect(
      harness.service.saveVersion(
        harness.actors.stranger,
        article.id,
        { ...DRAFT, expectedVersion: article.version },
        NOW,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('откат создаёт новую версию с текстом старой', async () => {
    const harness = setup();
    const article = await articleWithFacts(harness);
    await harness.service.saveVersion(
      harness.actors.owner,
      article.id,
      { ...DRAFT, expectedVersion: article.version },
      NOW,
    );

    const response = await harness.service.rollback(harness.actors.owner, article.id, 1, NOW);

    expect(response.version.number).toBe(2);
    expect(response.version.origin).toBe('rollback');
    expect(response.version.articleMarkdown).toBe(DRAFT.articleMarkdown);
    expect(harness.repo.audit.at(-1)).toMatchObject({ action: 'version.rollback' });
  });

  it('история и содержимое версии читаются', async () => {
    const harness = setup();
    const article = await articleWithFacts(harness);
    await harness.service.saveVersion(
      harness.actors.owner,
      article.id,
      { ...DRAFT, expectedVersion: article.version },
      NOW,
    );

    const versions = await harness.service.listVersions(harness.actors.owner, article.id);
    const version = await harness.service.getVersion(harness.actors.owner, article.id, 1);

    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ number: 1, origin: 'manual' });
    expect(version.title).toBe(DRAFT.title);
  });

  it('утверждённый материал не принимает новые версии', async () => {
    const harness = setup();
    const article = await articleWithFacts(harness);
    harness.repo.setStatus(article.id, 'approved');

    await expect(
      harness.service.saveVersion(
        harness.actors.owner,
        article.id,
        { ...DRAFT, expectedVersion: article.version },
        NOW,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('подтверждение проверок', () => {
  const BLOCKING = {
    id: 'numbers_must_map_to_facts',
    severity: 'block' as const,
    message: 'Число 42 не найдено в фактах',
    start: 10,
    end: 12,
    excerpt: '42',
  };

  async function articleWithVersion(harness: Harness) {
    const article = await createArticle(harness);
    await harness.repo.insertVersion(
      {
        articleId: article.id,
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
        createdBy: harness.actors.owner.id,
      },
      NOW,
    );
    return article;
  }

  it('автор подтверждает проверку с комментарием: появляется новая версия', async () => {
    const harness = setup();
    const article = await articleWithVersion(harness);

    const detail = await harness.service.confirmCheck(
      harness.actors.owner,
      article.id,
      1,
      0,
      'Число 42 — это номер пункта правил, а не данные.',
      NOW,
    );

    expect(detail.checks).toHaveLength(1);
    expect(detail.checks[0]).toMatchObject({
      id: 'numbers_must_map_to_facts',
      decision: 'confirmed',
      comment: 'Число 42 — это номер пункта правил, а не данные.',
      confirmedBy: harness.actors.owner.id,
    });
    expect(detail.versions[0]).toMatchObject({ number: 2, blockingChecks: 0 });
    expect(harness.repo.audit.at(-1)).toMatchObject({ action: 'check.confirm' });
  });

  it('подтверждённая проверка больше не блокирует переход на ревью', async () => {
    const harness = setup();
    const article = await articleWithVersion(harness);
    harness.repo.setStatus(article.id, 'drafting');

    await expect(
      harness.service.transition(
        harness.actors.owner,
        article.id,
        { to: 'in_review', expectedVersion: harness.repo.article(article.id)?.version ?? 0 },
        NOW,
      ),
    ).rejects.toThrow(/блокирующих проверок/);

    await harness.service.confirmCheck(
      harness.actors.owner,
      article.id,
      1,
      0,
      'Число 42 — это номер пункта правил.',
      NOW,
    );

    const after = await harness.service.transition(
      harness.actors.owner,
      article.id,
      { to: 'in_review', expectedVersion: harness.repo.article(article.id)?.version ?? 0 },
      NOW,
    );
    expect(after.status).toBe('in_review');
  });

  it('чужой пользователь не подтверждает проверку', async () => {
    const harness = setup();
    const article = await articleWithVersion(harness);

    await expect(
      harness.service.confirmCheck(harness.actors.stranger, article.id, 1, 0, 'Причина', NOW),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('несуществующая проверка и повторное подтверждение отклоняются', async () => {
    const harness = setup();
    const article = await articleWithVersion(harness);

    await expect(
      harness.service.confirmCheck(harness.actors.owner, article.id, 1, 5, 'Причина', NOW),
    ).rejects.toBeInstanceOf(NotFoundException);

    await harness.service.confirmCheck(harness.actors.owner, article.id, 1, 0, 'Причина', NOW);
    await expect(
      harness.service.confirmCheck(harness.actors.owner, article.id, 2, 0, 'Причина', NOW),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('подтверждение запуска генерации', () => {
  it('автор не подтверждает запуск своего материала', async () => {
    const harness = setup();
    const article = await createArticle(harness);

    await expect(
      harness.service.confirmGeneration(harness.actors.owner, article.id),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('тема вне фокуса ИИ требует подтверждения, ревьюер подтверждает', async () => {
    const harness = setup();
    const article = await createArticle(harness, { topic: 'Рецепт борща', keywords: ['суп'] });

    expect(article.generation.outOfFocus).toBe(true);
    expect(article.generation.confirmed).toBe(false);
    expect(article.generation.reason).toContain('подтверждения ревьюера');

    const confirmed = await harness.service.confirmGeneration(harness.actors.reviewer, article.id);

    expect(confirmed.generation.confirmed).toBe(true);
    expect(confirmed.generation.reason).not.toContain('подтверждения ревьюера');
    expect(harness.repo.audit.at(-1)).toMatchObject({ action: 'article.generation_confirm' });
  });

  it('повторное подтверждение не пишет вторую запись в аудит', async () => {
    const harness = setup();
    const article = await createArticle(harness, { topic: 'Рецепт борща', keywords: ['суп'] });

    await harness.service.confirmGeneration(harness.actors.reviewer, article.id);
    const auditsAfterFirst = harness.repo.audit.filter(
      (record) => record.action === 'article.generation_confirm',
    ).length;
    await harness.service.confirmGeneration(harness.actors.reviewer, article.id);
    const auditsAfterSecond = harness.repo.audit.filter(
      (record) => record.action === 'article.generation_confirm',
    ).length;

    expect(auditsAfterFirst).toBe(1);
    expect(auditsAfterSecond).toBe(1);
  });

  it('тема в фокусе ИИ подтверждения не требует', async () => {
    const harness = setup();
    const article = await createArticle(harness);

    expect(article.generation.outOfFocus).toBe(false);
  });
});

describe('создание материала', () => {
  it('начинается в статусе «Идея» с объёмом формата и тоном стиля', async () => {
    const harness = setup();

    const article = await createArticle(harness);

    expect(article).toMatchObject({
      status: 'idea',
      lengthMin: 4000,
      lengthMax: 6000,
      tone: 'neutral',
      owner: { login: 'anna' },
      version: 1,
    });
    expect(harness.repo.audit.at(-1)).toMatchObject({ action: 'article.create' });
  });

  it('тема вне фокуса ИИ даёт предупреждение, но материал создаётся', async () => {
    const harness = setup();

    const response = await harness.service.create(harness.actors.owner, {
      ...NEWS,
      topic: 'Рецепт борща',
      keywords: ['суп'],
    });

    expect(response.warnings).toContain(OUT_OF_FOCUS_WARNING);
    expect(response.article.status).toBe('idea');
  });

  it('объём вне диапазона формата даёт предупреждение', async () => {
    const harness = setup();

    const response = await harness.service.create(harness.actors.owner, {
      ...NEWS,
      lengthMin: 1000,
    });

    expect(response.warnings.some((line) => line.includes('вне диапазона формата'))).toBe(true);
  });

  it('формат, который стиль не допускает, отклоняется', async () => {
    const harness = setup();

    await expect(
      harness.service.create(harness.actors.owner, { ...NEWS, format: 'roundup' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('описание продукта без продукта отклоняется, с архивным продуктом тоже', async () => {
    const harness = setup();
    const product = {
      id: '00000000-0000-4000-8000-0000000000aa',
      slug: 'p',
      name: 'Продукт',
      oneLiner: '—',
      archived: true,
    };
    harness.catalog.products.push(product);
    const productInput = { styleId: 'product-description', format: 'article' as const };

    await expect(
      harness.service.create(harness.actors.owner, { ...NEWS, ...productInput }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      harness.service.create(harness.actors.owner, {
        ...NEWS,
        ...productInput,
        productId: product.id,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('список', () => {
  it('фильтр «мои» показывает только материалы владельца', async () => {
    const harness = setup();
    await createArticle(harness);
    await createArticle(harness, {}, harness.actors.stranger);

    const { items } = await harness.service.list(
      { mine: true, includeArchived: false },
      harness.actors.owner.id,
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.owner.login).toBe('anna');
  });

  it('архив скрыт по умолчанию и виден по флагу', async () => {
    const harness = setup();
    const article = await createArticle(harness);
    harness.repo.setStatus(article.id, 'archived');

    const hidden = await harness.service.list(
      { mine: false, includeArchived: false },
      harness.actors.owner.id,
    );
    const shown = await harness.service.list(
      { mine: false, includeArchived: true },
      harness.actors.owner.id,
    );

    expect(hidden.items).toHaveLength(0);
    expect(shown.items).toHaveLength(1);
  });
});

describe('переходы статусов', () => {
  it('автор переводит идею в «Факты», чужой автор получает запрет', async () => {
    const harness = setup();
    const article = await createArticle(harness);

    await expect(
      harness.service.transition(
        harness.actors.stranger,
        article.id,
        {
          to: 'researching',
          expectedVersion: 1,
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const updated = await harness.service.transition(
      harness.actors.owner,
      article.id,
      {
        to: 'researching',
        expectedVersion: 1,
      },
      NOW,
    );
    expect(updated.status).toBe('researching');
    expect(updated.version).toBe(2);
  });

  it('устаревшая версия материала отклоняется с конфликтом', async () => {
    const harness = setup();
    const article = await createArticle(harness);

    await expect(
      harness.service.transition(
        harness.actors.owner,
        article.id,
        { to: 'researching', expectedVersion: 7 },
        NOW,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('переход к черновику требует одобренных фактов стиля', async () => {
    const harness = setup();
    const article = await createArticle(harness);
    harness.repo.setStatus(article.id, 'researching');
    const input = { to: 'drafting' as const, expectedVersion: 1 };

    await expect(
      harness.service.transition(harness.actors.owner, article.id, input, NOW),
    ).rejects.toThrow(/Не хватает/);

    harness.repo.setTotals(article.id, {
      ...emptyFactTotals(),
      news_source: { count: 1, chars: 40 },
    });
    const updated = await harness.service.transition(harness.actors.owner, article.id, input, NOW);
    expect(updated.status).toBe('drafting');
  });

  it('на ревью уходит только версия без блокирующих проверок', async () => {
    const harness = setup();
    const article = await createArticle(harness);
    harness.repo.setStatus(article.id, 'drafting');
    const input = { to: 'in_review' as const, expectedVersion: 1 };

    await expect(
      harness.service.transition(harness.actors.owner, article.id, input, NOW),
    ).rejects.toThrow(/Нет версии текста/);

    harness.repo.addVersion(article.id, {
      checks: [
        { id: 'numbers_must_map_to_facts', severity: 'block', message: 'Число 42 не в фактах' },
      ],
    });
    await expect(
      harness.service.transition(harness.actors.owner, article.id, input, NOW),
    ).rejects.toThrow(/блокирующих проверок/);

    harness.repo.addVersion(article.id, { number: 2 });
    const updated = await harness.service.transition(harness.actors.owner, article.id, input, NOW);
    expect(updated.status).toBe('in_review');
  });

  it('ревьюер утверждает чужой материал: фиксируются решение и ревьюер', async () => {
    const harness = setup();
    const article = await createArticle(harness);
    harness.repo.setStatus(article.id, 'in_review', { currentVersionNumber: 1 });
    harness.repo.addVersion(article.id);

    const approved = await harness.service.transition(
      harness.actors.reviewer,
      article.id,
      { to: 'approved', expectedVersion: 1 },
      NOW,
    );

    expect(approved).toMatchObject({ status: 'approved', reviewer: { login: 'boris' } });
    expect(harness.repo.reviews).toEqual([
      expect.objectContaining({ decision: 'approved', versionNumber: 1 }),
    ]);
  });

  it('автор не утверждает собственный материал', async () => {
    const harness = setup();
    const article = await createArticle(harness);
    harness.repo.setStatus(article.id, 'in_review');
    harness.repo.addVersion(article.id);

    await expect(
      harness.service.transition(
        harness.actors.owner,
        article.id,
        { to: 'approved', expectedVersion: 1 },
        NOW,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('возврат на доработку требует комментарий', async () => {
    const harness = setup();
    const article = await createArticle(harness);
    harness.repo.setStatus(article.id, 'in_review');
    harness.repo.addVersion(article.id);
    const back = { to: 'drafting' as const, expectedVersion: 1 };

    await expect(
      harness.service.transition(harness.actors.reviewer, article.id, back, NOW),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    const updated = await harness.service.transition(
      harness.actors.reviewer,
      article.id,
      { ...back, comment: 'Уточните источник цифр' },
      NOW,
    );
    expect(updated.status).toBe('drafting');
    expect(harness.repo.reviews.at(-1)).toMatchObject({ decision: 'changes_requested' });
  });

  it('в график ставится только с плановой датой', async () => {
    const harness = setup();
    const article = await createArticle(harness);
    harness.repo.setStatus(article.id, 'approved');

    await expect(
      harness.service.transition(
        harness.actors.owner,
        article.id,
        { to: 'scheduled', expectedVersion: 1 },
        NOW,
      ),
    ).rejects.toThrow(/плановую дату/);

    const planned = await harness.service.update(
      harness.actors.owner,
      article.id,
      { expectedVersion: 1, plannedAt: PLAN },
      NOW,
    );
    const scheduled = await harness.service.transition(
      harness.actors.owner,
      article.id,
      { to: 'scheduled', expectedVersion: planned.version },
      NOW,
    );
    expect(scheduled.status).toBe('scheduled');
    expect(harness.repo.publications).toEqual([expect.objectContaining({ status: 'scheduled' })]);
  });

  it('публикация требует ссылку и сохраняет её в публикациях', async () => {
    const harness = setup();
    const article = await createArticle(harness);
    harness.repo.setStatus(article.id, 'approved');
    const publish = { to: 'published' as const, expectedVersion: 1 };

    await expect(
      harness.service.transition(harness.actors.owner, article.id, publish, NOW),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    const published = await harness.service.transition(
      harness.actors.reviewer,
      article.id,
      { ...publish, externalUrl: DZEN_URL },
      NOW,
    );
    expect(published.status).toBe('published');
    expect(harness.repo.publications.at(-1)).toMatchObject({
      status: 'published',
      externalUrl: DZEN_URL,
    });
  });

  it('администратор архивирует идею, архив получает дату', async () => {
    const harness = setup();
    const article = await createArticle(harness);

    const archived = await harness.service.transition(
      harness.actors.admin,
      article.id,
      { to: 'archived', expectedVersion: 1 },
      NOW,
    );

    expect(archived.status).toBe('archived');
    expect(harness.repo.articles.get(article.id)?.archivedAt).toEqual(NOW);
  });

  it('переход, которого нет в правилах, отклоняется', async () => {
    const harness = setup();
    const article = await createArticle(harness);

    await expect(
      harness.service.transition(
        harness.actors.owner,
        article.id,
        { to: 'published', expectedVersion: 1 },
        NOW,
      ),
    ).rejects.toThrow(/не предусмотрен правилами/);
  });
});

describe('изменение материала', () => {
  it('владелец меняет тему и получает новую версию записи', async () => {
    const harness = setup();
    const article = await createArticle(harness);

    const updated = await harness.service.update(
      harness.actors.owner,
      article.id,
      { expectedVersion: 1, topic: 'Новости о регулировании ИИ в ЕС' },
      NOW,
    );

    expect(updated).toMatchObject({ topic: 'Новости о регулировании ИИ в ЕС', version: 2 });
  });

  it('чужой автор не меняет материал, после утверждения текст зафиксирован', async () => {
    const harness = setup();
    const article = await createArticle(harness);
    await expect(
      harness.service.update(
        harness.actors.stranger,
        article.id,
        { expectedVersion: 1, topic: 'Чужая тема' },
        NOW,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    harness.repo.setStatus(article.id, 'approved');
    await expect(
      harness.service.update(
        harness.actors.owner,
        article.id,
        { expectedVersion: 1, topic: 'Новая тема' },
        NOW,
      ),
    ).rejects.toThrow(/до утверждения/);
  });

  it('правка со старой версией отклоняется', async () => {
    const harness = setup();
    const article = await createArticle(harness);

    await expect(
      harness.service.update(
        harness.actors.owner,
        article.id,
        { expectedVersion: 3, topic: 'Тема' },
        NOW,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('карточка материала', () => {
  it('для чужого автора переходы видны, но объясняют запрет', async () => {
    const harness = setup();
    const article = await createArticle(harness);

    const detail = await harness.service.get(harness.actors.stranger, article.id);

    expect(detail.transitions).toEqual([
      expect.objectContaining({
        to: 'researching',
        allowed: false,
        reason: expect.stringContaining('автор'),
      }),
      expect.objectContaining({ to: 'archived', allowed: false }),
    ]);
  });
});

function addNewsFact(harness: Harness, fields: Partial<StoredFact> = {}): StoredFact {
  return harness.facts.addFact({
    type: 'news_source',
    status: 'approved',
    text: 'Цитата из источника',
    sourceUrl: 'https://example.com/news/1',
    sourcePublishedAt: '2026-10-20',
    createdById: harness.actors.reviewer.id,
    ...fields,
  });
}

describe('факты материала', () => {
  it('владелец привязывает факты: метки F1, F2 по порядку, повтор отклоняется', async () => {
    const harness = setup();
    const article = await createArticle(harness);
    const first = addNewsFact(harness, { text: 'Первая цитата' });
    const second = addNewsFact(harness, { text: 'Вторая цитата' });

    const once = await harness.service.attachFact(harness.actors.owner, article.id, first.id);
    expect(once.facts).toEqual([
      expect.objectContaining({
        factId: first.id,
        label: 'F1',
        status: 'approved',
        text: 'Первая цитата',
        sourceUrl: 'https://example.com/news/1',
        sourcePublishedAt: '2026-10-20',
      }),
    ]);

    const twice = await harness.service.attachFact(harness.actors.owner, article.id, second.id);
    expect(twice.facts.map((fact) => fact.label)).toEqual(['F1', 'F2']);
    await expect(
      harness.service.attachFact(harness.actors.owner, article.id, first.id),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(harness.repo.audit.at(-1)).toMatchObject({
      action: 'article.fact_attach',
      payload: { factId: second.id, label: 'F2' },
    });
  });

  it('отклонённый и заменённый факт не привязываются', async () => {
    const harness = setup();
    const article = await createArticle(harness);
    const rejected = addNewsFact(harness, { status: 'rejected' });
    const superseded = addNewsFact(harness, { status: 'superseded' });

    for (const fact of [rejected, superseded]) {
      await expect(
        harness.service.attachFact(harness.actors.owner, article.id, fact.id),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    }
  });

  it('факт типа, который политика стиля не допускает, отклоняется', async () => {
    const harness = setup();
    const article = await createArticle(harness);
    const companyFact = harness.facts.addFact({
      type: 'company_fact',
      status: 'approved',
      createdById: harness.actors.reviewer.id,
    });

    await expect(
      harness.service.attachFact(harness.actors.owner, article.id, companyFact.id),
    ).rejects.toThrow(/не подходит стилю/);
  });

  it('факт о другом продукте не привязывается к материалу о продукте', async () => {
    const harness = setup();
    const productA = '00000000-0000-4000-8000-0000000000aa';
    const productB = '00000000-0000-4000-8000-0000000000bb';
    harness.catalog.products.push(
      { id: productA, slug: 'a', name: 'А', oneLiner: '—', archived: false },
      { id: productB, slug: 'b', name: 'Б', oneLiner: '—', archived: false },
    );
    const article = await createArticle(harness, {
      styleId: 'product-description',
      format: 'article',
      productId: productA,
    });
    const otherProduct = harness.facts.addFact({
      type: 'product_fact',
      status: 'approved',
      productId: productB,
      createdById: harness.actors.reviewer.id,
    });

    await expect(
      harness.service.attachFact(harness.actors.owner, article.id, otherProduct.id),
    ).rejects.toThrow(/другому продукту/);
  });

  it('чужой автор не привязывает факты, после утверждения факты не меняются', async () => {
    const harness = setup();
    const article = await createArticle(harness);
    const fact = addNewsFact(harness);

    await expect(
      harness.service.attachFact(harness.actors.stranger, article.id, fact.id),
    ).rejects.toBeInstanceOf(ForbiddenException);

    harness.repo.setStatus(article.id, 'approved');
    await expect(
      harness.service.attachFact(harness.actors.owner, article.id, fact.id),
    ).rejects.toThrow(/до утверждения/);
  });

  it('отвязка убирает факт, повторная отвязка — 404', async () => {
    const harness = setup();
    const article = await createArticle(harness);
    const fact = addNewsFact(harness);
    await harness.service.attachFact(harness.actors.owner, article.id, fact.id);

    const detached = await harness.service.detachFact(harness.actors.owner, article.id, fact.id);
    expect(detached.facts).toEqual([]);
    await expect(
      harness.service.detachFact(harness.actors.owner, article.id, fact.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('после отвязки метка не возвращается: новый факт получает следующий номер', async () => {
    const harness = setup();
    const article = await createArticle(harness);
    const first = addNewsFact(harness);
    const second = addNewsFact(harness);
    const third = addNewsFact(harness);
    await harness.service.attachFact(harness.actors.owner, article.id, first.id);
    await harness.service.attachFact(harness.actors.owner, article.id, second.id);
    await harness.service.detachFact(harness.actors.owner, article.id, second.id);

    const after = await harness.service.attachFact(harness.actors.owner, article.id, third.id);

    expect(after.facts.map((fact) => fact.label)).toEqual(['F1', 'F3']);
  });

  it('привязанный черновик не пускает на ревью, одобрение снимает запрет', async () => {
    const harness = setup();
    const article = await createArticle(harness);
    harness.repo.setStatus(article.id, 'drafting');
    harness.repo.addVersion(article.id);
    const draft = addNewsFact(harness, { status: 'draft' });
    await harness.service.attachFact(harness.actors.owner, article.id, draft.id);
    const toReview = { to: 'in_review' as const, expectedVersion: 1 };

    await expect(
      harness.service.transition(harness.actors.owner, article.id, toReview, NOW),
    ).rejects.toThrow('Привязанные факты не одобрены: F1 (черновик)');

    harness.facts.facts.set(draft.id, { ...draft, status: 'approved' });
    const inReview = await harness.service.transition(
      harness.actors.owner,
      article.id,
      toReview,
      NOW,
    );
    expect(inReview.status).toBe('in_review');
  });

  it('заменённый факт тоже не пускает на ревью', async () => {
    const harness = setup();
    const article = await createArticle(harness);
    harness.repo.setStatus(article.id, 'drafting');
    harness.repo.addVersion(article.id);
    const fact = addNewsFact(harness);
    await harness.service.attachFact(harness.actors.owner, article.id, fact.id);
    harness.facts.facts.set(fact.id, { ...fact, status: 'superseded' });

    await expect(
      harness.service.transition(
        harness.actors.owner,
        article.id,
        { to: 'in_review', expectedVersion: 1 },
        NOW,
      ),
    ).rejects.toThrow(/F1 \(заменён\)/);
  });
});
