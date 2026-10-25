import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { CreateFactInput, UpdateFactInput } from '@dzenwriter/shared';
import { describe, expect, it } from 'vitest';
import { FactsService } from '../src/facts/facts.service';
import { InMemoryCatalog } from './support/in-memory-catalog';
import { InMemoryFactsRepository } from './support/in-memory-facts.repository';

const NOW = new Date('2026-10-22T10:00:00Z');
const SOURCE = {
  sourceUrl: 'https://example.com/news/1',
  sourcePublishedAt: '2026-10-20',
};

function setup() {
  const repo = new InMemoryFactsRepository();
  const catalog = new InMemoryCatalog();
  const service = new FactsService(repo, catalog);
  const author = repo.addPerson('anna');
  const reviewer = repo.addPerson('boris');
  const admin = repo.addPerson('chief');
  const actors = {
    author: { id: author.id, role: 'author' as const },
    reviewer: { id: reviewer.id, role: 'reviewer' as const },
    admin: { id: admin.id, role: 'admin' as const },
  };
  return { repo, catalog, service, actors };
}

type Harness = ReturnType<typeof setup>;

async function createFact(harness: Harness, input: CreateFactInput, actor = harness.actors.author) {
  return harness.service.create(actor, input);
}

async function approvedNews(harness: Harness) {
  const created = await createFact(harness, {
    type: 'news_source',
    text: 'Цитата из статьи',
    ...SOURCE,
  });
  return harness.service.approve(
    harness.actors.reviewer,
    created.id,
    { expectedVersion: created.version },
    NOW,
  );
}

describe('создание и правка', () => {
  it('новый факт — черновик версии 1, аудит пишется без текста', async () => {
    const harness = setup();

    const created = await createFact(harness, {
      type: 'news_source',
      text: 'Цитата из статьи',
      ...SOURCE,
    });

    expect(created).toMatchObject({ status: 'draft', version: 1, createdBy: { login: 'anna' } });
    expect(harness.repo.audit.at(-1)).toEqual({
      actorId: harness.actors.author.id,
      action: 'fact.create',
      entityType: 'fact',
      entityId: created.id,
      payload: { type: 'news_source' },
    });
  });

  it('факт о продукте с архивным продуктом отклоняется', async () => {
    const harness = setup();
    harness.catalog.products.push({
      id: '00000000-0000-4000-8000-0000000000bb',
      slug: 'old',
      name: 'Старый продукт',
      oneLiner: '—',
      archived: true,
    });

    await expect(
      createFact(harness, {
        type: 'product_fact',
        text: 'Факт о продукте',
        productId: '00000000-0000-4000-8000-0000000000bb',
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('правка черновика увеличивает версию, устаревшая версия отклоняется', async () => {
    const harness = setup();
    const created = await createFact(harness, { type: 'company_fact', text: 'Старый текст' });
    const patch: UpdateFactInput = { expectedVersion: 1, text: 'Новый текст' };

    const updated = await harness.service.update(harness.actors.author, created.id, patch, NOW);
    expect(updated).toMatchObject({ text: 'Новый текст', version: 2 });

    await expect(
      harness.service.update(harness.actors.author, created.id, patch, NOW),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('сброс ссылки у новости делает факт неполным и отклоняет правку', async () => {
    const harness = setup();
    const created = await createFact(harness, {
      type: 'news_source',
      text: 'Цитата',
      ...SOURCE,
    });

    await expect(
      harness.service.update(
        harness.actors.author,
        created.id,
        { expectedVersion: 1, sourceUrl: null },
        NOW,
      ),
    ).rejects.toThrow(/ссылку на материал/);
  });

  it('автор не меняет чужой факт', async () => {
    const harness = setup();
    const created = await createFact(harness, { type: 'company_fact', text: 'Факт' });

    await expect(
      harness.service.update(
        { id: 'stranger', role: 'author' },
        created.id,
        { expectedVersion: 1, text: 'Чужая правка' },
        NOW,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('одобрение', () => {
  it('ревьюер одобряет черновик: фиксируются кто и когда', async () => {
    const harness = setup();
    const created = await createFact(harness, { type: 'company_fact', text: 'Факт компании' });

    const approved = await harness.service.approve(
      harness.actors.reviewer,
      created.id,
      { expectedVersion: 1 },
      NOW,
    );

    expect(approved).toMatchObject({
      status: 'approved',
      approvedBy: { login: 'boris' },
      approvedAt: NOW.toISOString(),
      version: 2,
    });
    expect(harness.repo.audit.at(-1)).toMatchObject({ action: 'fact.approve' });
  });

  it('автор не одобряет свой факт и видит это в действиях карточки', async () => {
    const harness = setup();
    const created = await createFact(harness, { type: 'company_fact', text: 'Факт' });

    await expect(
      harness.service.approve(harness.actors.author, created.id, { expectedVersion: 1 }, NOW),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const { items } = await harness.service.list(harness.actors.author, {});
    expect(items[0]?.actions.approve).toMatchObject({ allowed: false });
    const reviewerView = await harness.service.list(harness.actors.reviewer, {});
    expect(reviewerView.items[0]?.actions.approve.allowed).toBe(true);
  });

  it('заметка опыта без согласия не одобряется: 409 с причинами', async () => {
    const harness = setup();
    const note = await createFact(harness, { type: 'experience_note', text: 'Заметка' });

    await expect(
      harness.service.approve(harness.actors.reviewer, note.id, { expectedVersion: 1 }, NOW),
    ).rejects.toThrow(/согласие получено/);
  });

  it('одобренный факт не редактируется', async () => {
    const harness = setup();
    const approved = await approvedNews(harness);

    await expect(
      harness.service.update(
        harness.actors.author,
        approved.id,
        { expectedVersion: approved.version, text: 'Правка' },
        NOW,
      ),
    ).rejects.toThrow(/исправить его можно только новым фактом/);
  });
});

describe('исправление одобренного факта', () => {
  it('исправление — новый черновик, исходный остаётся в силе до одобрения замены', async () => {
    const harness = setup();
    const original = await approvedNews(harness);

    const correction = await harness.service.correct(harness.actors.author, original.id, {
      text: 'Уточнённая цитата',
      ...SOURCE,
    });

    expect(correction).toMatchObject({ status: 'draft', supersedesId: original.id });
    const stillApproved = await harness.service.list(harness.actors.author, {});
    expect(stillApproved.items.find((item) => item.id === original.id)).toMatchObject({
      status: 'approved',
      hasPendingCorrection: true,
    });
  });

  it('одобрение исправления переводит исходный факт в «заменён» в той же операции', async () => {
    const harness = setup();
    const original = await approvedNews(harness);
    const correction = await harness.service.correct(harness.actors.author, original.id, {
      text: 'Уточнённая цитата',
      ...SOURCE,
    });

    const approved = await harness.service.approve(
      harness.actors.reviewer,
      correction.id,
      { expectedVersion: correction.version },
      NOW,
    );

    expect(approved.status).toBe('approved');
    const { items } = await harness.service.list(harness.actors.reviewer, {});
    expect(items.find((item) => item.id === original.id)).toMatchObject({
      status: 'superseded',
      supersededById: correction.id,
    });
    expect(harness.repo.audit.map((record) => record.action)).toEqual(
      expect.arrayContaining(['fact.supersede', 'fact.approve']),
    );
  });

  // Через сервис два исправления сразу не создать; параллельный запрос моделируем записью в репозиторий.
  it('исправление, созданное параллельно, не одобряется после замены исходного факта', async () => {
    const harness = setup();
    const original = await approvedNews(harness);
    const first = await harness.service.correct(harness.actors.author, original.id, {
      text: 'Первое',
      ...SOURCE,
    });
    await harness.service.reject(
      harness.actors.reviewer,
      first.id,
      { expectedVersion: first.version },
      NOW,
    );
    const second = await harness.service.correct(harness.actors.author, original.id, {
      text: 'Второе',
      ...SOURCE,
    });
    await harness.service.approve(
      harness.actors.reviewer,
      second.id,
      { expectedVersion: second.version },
      NOW,
    );

    const third = await harness.repo.insertFact({
      type: 'news_source',
      text: 'Третье',
      sourceName: null,
      ...SOURCE,
      productId: null,
      mentionsClient: false,
      clientPermission: false,
      supersedesId: original.id,
      createdBy: harness.actors.author.id,
    });
    await expect(
      harness.service.approve(harness.actors.reviewer, third, { expectedVersion: 1 }, NOW),
    ).rejects.toThrow(/уже не одобрен/);
  });

  it('отклонённое исправление оставляет исходный факт одобренным', async () => {
    const harness = setup();
    const original = await approvedNews(harness);
    const correction = await harness.service.correct(harness.actors.author, original.id, {
      text: 'Ошибочное исправление',
      ...SOURCE,
    });

    await harness.service.reject(
      harness.actors.reviewer,
      correction.id,
      { expectedVersion: correction.version },
      NOW,
    );

    const { items } = await harness.service.list(harness.actors.reviewer, {});
    expect(items.find((item) => item.id === original.id)?.status).toBe('approved');
    expect(items.find((item) => item.id === original.id)?.hasPendingCorrection).toBe(false);
  });

  it('второе исправление на проверке не создаётся', async () => {
    const harness = setup();
    const original = await approvedNews(harness);
    await harness.service.correct(harness.actors.author, original.id, {
      text: 'Первое',
      ...SOURCE,
    });

    await expect(
      harness.service.correct(harness.actors.author, original.id, {
        text: 'Второе',
        ...SOURCE,
      }),
    ).rejects.toThrow(/уже на проверке/);
  });
});

describe('согласие на личный опыт', () => {
  it('ревьюер подтверждает согласие, автор отзывает: текст удаляется, аудит без текста', async () => {
    const harness = setup();
    const note = await createFact(harness, {
      type: 'experience_note',
      text: 'Личная история с именем Ивана',
    });
    const confirmed = await harness.service.confirmConsent(
      harness.actors.reviewer,
      note.id,
      { expectedVersion: 1, anonymized: true },
      NOW,
    );
    expect(confirmed).toMatchObject({
      consentConfirmed: true,
      consentConfirmedBy: 'boris',
      anonymized: true,
    });

    const withdrawn = await harness.service.withdrawConsent(
      harness.actors.author,
      note.id,
      { expectedVersion: confirmed.version },
      NOW,
    );

    expect(withdrawn).toMatchObject({
      text: '',
      status: 'rejected',
      consentConfirmed: false,
      anonymized: false,
    });
    const record = harness.repo.audit.at(-1);
    expect(record).toEqual({
      actorId: harness.actors.author.id,
      action: 'consent.withdraw',
      entityType: 'fact',
      entityId: note.id,
      payload: {},
    });
  });

  it('повторный отзыв согласия отклоняется', async () => {
    const harness = setup();
    const note = await createFact(harness, { type: 'experience_note', text: 'Заметка' });
    const withdrawn = await harness.service.withdrawConsent(
      harness.actors.author,
      note.id,
      { expectedVersion: 1 },
      NOW,
    );

    await expect(
      harness.service.withdrawConsent(
        harness.actors.author,
        note.id,
        { expectedVersion: withdrawn.version },
        NOW,
      ),
    ).rejects.toThrow(/уже отозвано/);
  });
});

describe('список фактов', () => {
  it('фильтры по типу и тексту, без лишних записей', async () => {
    const harness = setup();
    await createFact(harness, { type: 'company_fact', text: 'Команда измеряет точность ответов' });
    await createFact(harness, { type: 'company_fact', text: 'Офис в Казани' });
    await createFact(harness, { type: 'experience_note', text: 'Точность ответов в бухгалтерии' });

    const byType = await harness.service.list(harness.actors.reviewer, {
      type: 'company_fact',
    });
    expect(byType.items).toHaveLength(2);

    const byText = await harness.service.list(harness.actors.reviewer, { q: 'Казани' });
    expect(byText.items.map((item) => item.text)).toEqual(['Офис в Казани']);
    expect(byText.truncated).toBe(false);
  });
});

describe('где используется', () => {
  it('возвращает материалы с привязкой: свежие обновления раньше', async () => {
    const harness = setup();
    const fact = await approvedNews(harness);
    harness.repo.addUsage(fact.id, {
      articleId: '00000000-0000-4000-8000-00000000a1',
      topic: 'Старый материал',
      status: 'published',
      updatedAt: new Date('2026-10-20T10:00:00Z'),
    });
    harness.repo.addUsage(fact.id, {
      articleId: '00000000-0000-4000-8000-00000000a2',
      topic: 'Свежий материал',
      status: 'in_review',
      updatedAt: new Date('2026-10-21T10:00:00Z'),
    });

    const usage = await harness.service.usage(harness.actors.author, fact.id);

    expect(usage.truncated).toBe(false);
    expect(usage.items.map((item) => item.topic)).toEqual(['Свежий материал', 'Старый материал']);
    expect(usage.items[0]).toMatchObject({
      articleId: '00000000-0000-4000-8000-00000000a2',
      status: 'in_review',
      updatedAt: '2026-10-21T10:00:00.000Z',
    });
  });

  it('лимит обрезает список и отмечает truncated', async () => {
    const harness = setup();
    const fact = await approvedNews(harness);
    for (let index = 0; index < 501; index += 1) {
      const suffix = String(index).padStart(12, '0');
      harness.repo.addUsage(fact.id, {
        articleId: `00000000-0000-4000-8000-${suffix}`,
        topic: `Материал ${suffix}`,
        status: 'drafting',
        updatedAt: new Date(2026, 8, 1, 10, index % 60),
      });
    }

    const usage = await harness.service.usage(harness.actors.reviewer, fact.id);

    expect(usage.items).toHaveLength(500);
    expect(usage.truncated).toBe(true);
  });

  it('неизвестный факт не отдаёт привязки', async () => {
    const harness = setup();
    await expect(
      harness.service.usage(harness.actors.author, '00000000-0000-4000-8000-0000000000f1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
