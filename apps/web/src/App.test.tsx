import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { App } from './App';

const ADMIN = {
  id: '00000000-0000-4000-8000-000000000001',
  login: 'anna',
  name: 'Анна Иванова',
  role: 'admin',
};
const AUTHOR = {
  ...ADMIN,
  id: '00000000-0000-4000-8000-000000000002',
  login: 'boris',
  name: 'Борис',
  role: 'author',
};
const REVIEWER = {
  ...ADMIN,
  id: '00000000-0000-4000-8000-000000000003',
  login: 'vera',
  name: 'Вера',
  role: 'reviewer',
};
const ARTICLE_ID = '00000000-0000-4000-8000-0000000000a1';
const FACT_ID = '00000000-0000-4000-8000-0000000000f1';
const PRODUCT = {
  id: '00000000-0000-4000-8000-0000000000e1',
  slug: 'demo-product',
  name: 'Демо-продукт',
  oneLiner: 'Пример продукта',
  archived: false,
};

const ALLOWED = { allowed: true, reason: null };
const DENIED = (reason: string) => ({ allowed: false, reason });
const FACT_ACTIONS = {
  edit: ALLOWED,
  approve: ALLOWED,
  reject: ALLOWED,
  confirmConsent: DENIED('Согласие подтверждают у заметок опыта'),
  withdrawConsent: DENIED('Отзыв согласия относится только к заметкам опыта'),
  correct: DENIED('Исправить можно только одобренный факт'),
};

// Факт в формате API: поля совпадают с factItemSchema из shared.
function factItem(overrides: Record<string, unknown> = {}) {
  return {
    id: FACT_ID,
    type: 'company_fact',
    status: 'draft',
    text: 'Команда измеряет точность ответов на эталонном наборе',
    sourceName: null,
    sourceUrl: null,
    sourcePublishedAt: null,
    productId: null,
    productName: null,
    mentionsClient: false,
    clientPermission: false,
    consentConfirmed: false,
    consentConfirmedBy: null,
    consentConfirmedAt: null,
    anonymized: false,
    createdBy: { id: ADMIN.id, login: 'anna', name: 'Анна Иванова' },
    approvedBy: null,
    approvedAt: null,
    supersedesId: null,
    supersededById: null,
    hasPendingCorrection: false,
    version: 1,
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-21T10:00:00.000Z',
    actions: FACT_ACTIONS,
    ...overrides,
  };
}

const STYLE = {
  id: 'industry-news',
  name: 'Новости индустрии',
  summary: 'Аналитика событий ИИ-индустрии.',
  audience: 'Разработчики',
  version: 1,
  allowedFormats: ['news', 'article', 'longread'],
  defaultTone: 'neutral',
  voice: { person: 'third', register: 'analytical', readerAddress: 'none' },
  factPolicy: 'sourced',
  inputs: {
    requiredFactTypes: ['news_source'],
    minFacts: 1,
    minNoteChars: null,
    requiresProduct: false,
    requiresConsent: false,
    requiresAnonymization: false,
  },
  checks: [{ id: 'numbers_must_map_to_facts', severity: 'block' }],
  disclaimer: { forTopics: ['medical'], always: false, text: 'Не консультация.' },
};

const FORMAT = {
  id: 'news',
  name: 'Новость',
  length: { min: 4000, max: 6000 },
  blocks: { min: 2, max: 3 },
  items: null,
  structure: 'лид → контекст → что проверить',
};

const ITEM = {
  id: ARTICLE_ID,
  topic: 'Агенты на длинных задачах',
  keywords: ['LLM'],
  title: null,
  styleId: 'industry-news',
  styleName: 'Новости индустрии',
  format: 'article',
  tone: 'neutral',
  lengthMin: 8000,
  lengthMax: 12000,
  productId: null,
  status: 'idea',
  owner: { id: ADMIN.id, login: 'anna', name: 'Анна Иванова' },
  reviewer: null,
  plannedAt: null,
  currentVersionNumber: null,
  version: 1,
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-21T10:00:00.000Z',
};

const DETAIL = {
  ...ITEM,
  requirements: [
    { title: 'Одобренные факты: источник новости', required: 1, actual: 0, met: false },
  ],
  transitions: [
    { to: 'researching', allowed: true, reason: null, needsComment: false, needsUrl: false },
    { to: 'archived', allowed: true, reason: null, needsComment: false, needsUrl: false },
  ],
  versions: [],
  reviews: [],
  publications: [],
  facts: [],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Handler = (init?: RequestInit) => Response | Promise<Response>;

// Заглушки API по методу и пути. Остальные маршруты не нужны каждому тесту.
function stubApi(overrides: Record<string, Handler> = {}, me: unknown = ADMIN) {
  const routes: Record<string, Handler> = {
    'GET /ready': () => json({ status: 'ready', checks: { database: 'ok' } }),
    'GET /api/v1/me': () => (me === null ? json({ status: 401 }, 401) : json(me)),
    'GET /api/v1/styles': () => json({ items: [STYLE] }),
    'GET /api/v1/formats': () => json({ items: [FORMAT] }),
    'GET /api/v1/products': () => json({ items: [] }),
    'GET /api/v1/facts': () => json({ items: [], truncated: false }),
    'GET /api/v1/articles': () => json({ items: [ITEM], truncated: false }),
    [`GET /api/v1/articles/${ARTICLE_ID}`]: () => json(DETAIL),
    ...overrides,
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const key = `${init?.method ?? 'GET'} ${url.pathname}`;
    const handler = routes[key];
    if (!handler) {
      throw new Error(`Нет заглушки для ${key}`);
    }
    return handler(init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe('приложение', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('без входа ведёт на экран входа и показывает состояние сервиса', async () => {
    stubApi({}, null);

    renderAt('/');

    expect(await screen.findByRole('link', { name: 'Войти через GitHub' })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Сервис готов'));
  });

  it('показывает причину отказа, пришедшую в адресе входа', async () => {
    stubApi({}, null);

    renderAt('/login?error=not_member');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('участникам организации iilmchat');
  });

  it('доска раскладывает материалы по колонкам статусов', async () => {
    stubApi();

    renderAt('/');

    const topic = await screen.findByText('Агенты на длинных задачах');
    expect(topic.closest('section')?.textContent).toContain('Идея');
  });

  it('короткая тема ловится в форме до отправки', async () => {
    const fetchMock = stubApi();
    renderAt('/');

    fireEvent.click(await screen.findByRole('button', { name: 'Новый материал' }));
    fireEvent.change(await screen.findByLabelText(/Тема или инфоповод/), {
      target: { value: 'Аг' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Создать материал' }));

    expect((await screen.findByText('Тема короче 3 знаков')).textContent).toContain('короче');
    const posted = fetchMock.mock.calls.some(([, init]) => init?.method === 'POST');
    expect(posted).toBe(false);
  });

  it('переход по карточке меняет статус и отправляет ожидаемую версию', async () => {
    const posted: unknown[] = [];
    const fetchMock = stubApi({
      [`POST /api/v1/articles/${ARTICLE_ID}/transitions`]: (init) => {
        posted.push(JSON.parse(String(init?.body)));
        return json({ ...DETAIL, status: 'researching', version: 2 });
      },
    });
    renderAt(`/articles/${ARTICLE_ID}`);

    fireEvent.click(await screen.findByRole('radio', { name: 'Факты' }));
    fireEvent.click(screen.getByRole('button', { name: 'Перевести' }));

    expect(await screen.findByText('Статус: Факты')).toBeTruthy();
    expect(posted).toEqual([{ to: 'researching', expectedVersion: 1 }]);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('стили и форматы показываются карточками на одной странице', async () => {
    stubApi();

    renderAt('/styles');

    expect(await screen.findByRole('heading', { name: 'Новости индустрии' })).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Форматы материалов' })).toBeTruthy();
  });

  it('раздел пользователей закрыт для ролей, кроме администратора', async () => {
    stubApi({}, AUTHOR);

    renderAt('/admin/users');

    expect(await screen.findByText('Этот раздел недоступен для вашей роли.')).toBeTruthy();
  });

  it('факт-база: ревьюер одобряет чужой черновик', async () => {
    stubApi(
      { 'GET /api/v1/facts': () => json({ items: [factItem()], truncated: false }) },
      REVIEWER,
    );

    renderAt('/facts');

    expect(await screen.findByRole('button', { name: 'Одобрить' })).toBeTruthy();
    expect(screen.getByText('Команда измеряет точность ответов на эталонном наборе')).toBeTruthy();
  });

  it('факт-база: автор не видит кнопку одобрения и читает причину', async () => {
    const reason = 'Решение по факту принимает ревьюер или администратор';
    stubApi(
      {
        'GET /api/v1/facts': () =>
          json({
            items: [factItem({ actions: { ...FACT_ACTIONS, approve: DENIED(reason) } })],
            truncated: false,
          }),
      },
      AUTHOR,
    );

    renderAt('/facts');

    expect(await screen.findByText(reason)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Одобрить' })).toBeNull();
  });

  it('продукты: автор видит справочник, но не меняет его', async () => {
    stubApi({ 'GET /api/v1/products': () => json({ items: [PRODUCT] }) }, AUTHOR);

    renderAt('/products');

    expect(await screen.findByText('Демо-продукт')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Новый продукт' })).toBeNull();
    expect(screen.getByText(/Справочник ведёт администратор/)).toBeTruthy();
  });

  it('карточка материала: владелец привязывает факт из библиотеки', async () => {
    const posted: unknown[] = [];
    const attached = {
      factId: FACT_ID,
      label: 'F1',
      type: 'news_source',
      status: 'approved',
      text: 'Цитата из источника',
      sourceName: 'Демо-источник',
      sourceUrl: 'https://example.com/news/1',
      sourcePublishedAt: '2026-10-20',
    };
    stubApi({
      'GET /api/v1/facts': () =>
        json({
          items: [
            factItem({
              type: 'news_source',
              status: 'approved',
              text: 'Цитата из источника',
              sourceUrl: 'https://example.com/news/1',
              sourcePublishedAt: '2026-10-20',
            }),
          ],
          truncated: false,
        }),
      [`POST /api/v1/articles/${ARTICLE_ID}/facts`]: (init) => {
        posted.push(JSON.parse(String(init?.body)));
        return json({ ...DETAIL, facts: [attached] });
      },
    });

    renderAt(`/articles/${ARTICLE_ID}`);

    fireEvent.change(await screen.findByLabelText('Факт'), { target: { value: FACT_ID } });
    fireEvent.click(screen.getByRole('button', { name: 'Привязать' }));

    expect(await screen.findByText('F1 · Источник новости · Одобрен')).toBeTruthy();
    expect(posted).toEqual([{ factId: FACT_ID }]);
  });
});
