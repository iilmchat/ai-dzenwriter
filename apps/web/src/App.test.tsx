import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  blockingChecks: 0,
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
  checks: [],
  generation: {
    allowed: false,
    reason: 'Не хватает: Одобренные факты: источник новости, 0 из 1',
    outOfFocus: false,
    confirmed: false,
  },
};

// Полная версия в формате API: страница материала и редактор грузят её отдельно.
function versionDetail(overrides: Record<string, unknown> = {}) {
  return {
    number: 1,
    origin: 'manual',
    title: 'Текст статьи',
    articleMarkdown: 'Текст статьи.',
    seoTitle: '',
    tags: [],
    description: '',
    imagePrompt: '',
    advertisingLabel: false,
    disclaimerText: null,
    claims: [],
    checks: [],
    styleVersion: 1,
    promptVersion: 'sha256:test',
    generationRunId: null,
    createdAt: '2026-10-22T10:00:00.000Z',
    createdBy: 'anna',
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Поток SSE для проверки панели генерации.
function sse(events: readonly { readonly event: string; readonly data: unknown }[]): Response {
  const body = events
    .map((item) => `event: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`)
    .join('');
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
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
    [`GET /api/v1/articles/${ARTICLE_ID}/generations`]: () => json({ items: [] }),
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
    window.localStorage.clear();
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

  it('карточка доски показывает блокировки и следующий шаг', async () => {
    stubApi(
      {
        'GET /api/v1/articles': () =>
          json({
            items: [{ ...ITEM, status: 'drafting', blockingChecks: 2 }],
            truncated: false,
          }),
      },
      ADMIN,
    );

    renderAt('/');

    expect(await screen.findByText('2 блокирующих')).toBeTruthy();
    expect(screen.getByText('Дописать текст и отправить на ревью')).toBeTruthy();
    expect(screen.getByText('АИ')).toBeTruthy();
  });

  it('доска фильтрует материалы по владельцу и блокировкам', async () => {
    const blocked = { ...ITEM, status: 'drafting' as const, blockingChecks: 1 };
    const other = {
      ...ITEM,
      id: '00000000-0000-4000-8000-0000000000c1',
      topic: 'Другой материал',
      owner: AUTHOR,
      status: 'idea' as const,
    };
    stubApi(
      {
        'GET /api/v1/articles': () => json({ items: [blocked, other], truncated: false }),
      },
      ADMIN,
    );

    renderAt('/');

    expect(await screen.findByText('Другой материал')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Только с блокировками'));
    await waitFor(() => expect(screen.queryByText('Другой материал')).toBeNull());
    expect(screen.getByText('1 блокирующая')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Только с блокировками'));
    fireEvent.change(screen.getByLabelText('Владелец'), { target: { value: AUTHOR.id } });
    await waitFor(() => expect(screen.getByText('Другой материал')).toBeTruthy());
    expect(screen.queryByText('Агенты на длинных задачах')).toBeNull();
  });

  it('материал можно переместить между колонками через меню', async () => {
    const posted: unknown[] = [];
    stubApi({
      [`POST /api/v1/articles/${ARTICLE_ID}/transitions`]: (init) => {
        posted.push(JSON.parse(String(init?.body)));
        return json({ ...DETAIL, status: 'researching', version: 2 });
      },
    });

    renderAt('/');

    fireEvent.change(await screen.findByLabelText('Переместить материал'), {
      target: { value: 'researching' },
    });

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ to: 'researching', expectedVersion: 1 });
    expect(await screen.findByText('Привязать факты и перейти к черновику')).toBeTruthy();
  });

  it('мои задачи: ревьюер видит очередь и свои материалы по действиям', async () => {
    const task = (overrides: Record<string, unknown>) => ({
      ...ITEM,
      id: '00000000-0000-4000-8000-0000000000b1',
      owner: AUTHOR,
      updatedAt: '2026-10-21T10:00:00.000Z',
      ...overrides,
    });
    stubApi(
      {
        'GET /api/v1/articles': () =>
          json({
            items: [
              task({ topic: 'Чужой материал на ревью', status: 'in_review' }),
              task({
                id: '00000000-0000-4000-8000-0000000000b2',
                topic: 'Мой черновик',
                owner: REVIEWER,
                status: 'drafting',
              }),
              task({
                id: '00000000-0000-4000-8000-0000000000b3',
                topic: 'Мой утверждённый материал',
                owner: REVIEWER,
                status: 'approved',
              }),
              task({
                id: '00000000-0000-4000-8000-0000000000b4',
                topic: 'Мой материал на ревью',
                owner: REVIEWER,
                status: 'in_review',
              }),
              task({
                id: '00000000-0000-4000-8000-0000000000b5',
                topic: 'Мой опубликованный материал',
                owner: REVIEWER,
                status: 'published',
              }),
              task({
                id: '00000000-0000-4000-8000-0000000000b6',
                topic: 'Чужая идея',
                owner: AUTHOR,
                status: 'idea',
              }),
            ],
            truncated: false,
          }),
      },
      REVIEWER,
    );

    renderAt('/tasks');

    expect(await screen.findByRole('heading', { name: 'Мои задачи' })).toBeTruthy();
    expect(await screen.findByText('Всего задач: 4')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /На ревью/ })).toBeTruthy();
    expect(screen.getByText('Прочитать текст и принять решение')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Доработать/ })).toBeTruthy();
    expect(screen.getByText('Дописать текст и отправить на ревью')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Опубликовать/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Ждёт ревью/ })).toBeTruthy();
    expect(screen.queryByText('Мой опубликованный материал')).toBeNull();
    expect(screen.queryByText('Чужая идея')).toBeNull();
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

  it('ревьюер заполняет рубрику при утверждении: форма ловит частичный ввод', async () => {
    const posted: unknown[] = [];
    const inReview = {
      ...DETAIL,
      status: 'in_review',
      currentVersionNumber: 1,
      transitions: [
        { to: 'approved', allowed: true, reason: null, needsComment: false, needsUrl: false },
      ],
    };
    stubApi({
      [`GET /api/v1/articles/${ARTICLE_ID}`]: () => json(inReview),
      [`POST /api/v1/articles/${ARTICLE_ID}/transitions`]: (init) => {
        posted.push(JSON.parse(String(init?.body)));
        return json(inReview);
      },
    });
    renderAt(`/articles/${ARTICLE_ID}`);

    fireEvent.click(await screen.findByRole('radio', { name: 'Утверждено' }));
    expect(screen.getByRole('group', { name: 'Рубрика редактора' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Крючки'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Перевести' }));

    expect(await screen.findByText(/Заполните все пять критериев рубрики/)).toBeTruthy();
    expect(posted).toHaveLength(0);
  });

  it('полная рубрика уходит в API, история ревью показывает разбивку', async () => {
    const posted: unknown[] = [];
    const inReview = {
      ...DETAIL,
      status: 'in_review',
      currentVersionNumber: 1,
      transitions: [
        { to: 'approved', allowed: true, reason: null, needsComment: false, needsUrl: false },
      ],
    };
    const approved = {
      ...inReview,
      status: 'approved',
      reviews: [
        {
          decision: 'approved',
          comment: null,
          versionNumber: 1,
          reviewerLogin: 'anna',
          rating: 4,
          rubric: { accuracy: 5, style: 4, readability: 5, hooks: 3, cliches: 3 },
          createdAt: '2026-10-26T09:00:00.000Z',
        },
      ],
    };
    stubApi({
      [`GET /api/v1/articles/${ARTICLE_ID}`]: () => json(inReview),
      [`POST /api/v1/articles/${ARTICLE_ID}/transitions`]: (init) => {
        posted.push(JSON.parse(String(init?.body)));
        return json(approved);
      },
    });
    renderAt(`/articles/${ARTICLE_ID}`);

    fireEvent.click(await screen.findByRole('radio', { name: 'Утверждено' }));
    for (const [label, value] of [
      ['Точность', '5'],
      ['Стиль', '4'],
      ['Читаемость', '5'],
      ['Крючки', '3'],
      ['Штампы', '3'],
    ] as Array<[string, string]>) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Перевести' }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      to: 'approved',
      expectedVersion: 1,
      rubric: { accuracy: 5, style: 4, readability: 5, hooks: 3, cliches: 3 },
    });
    expect(await screen.findByText(/оценка 4 из 5/)).toBeTruthy();
    expect(
      screen.getByText(/среднее по рубрике: точность 5, стиль 4, читаемость 5, крючки 3, штампы 3/),
    ).toBeTruthy();
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

  it('администратор меняет роль и отключает пользователя из таблицы', async () => {
    const patches: Array<{ id: string; body: unknown }> = [];
    const admin = {
      id: ADMIN.id,
      login: ADMIN.login,
      name: ADMIN.name,
      role: 'admin',
      disabled: false,
      createdAt: '2026-10-20T10:00:00.000Z',
    };
    const vera = {
      id: REVIEWER.id,
      login: REVIEWER.login,
      name: REVIEWER.name,
      role: 'reviewer',
      disabled: false,
      createdAt: '2026-10-21T10:00:00.000Z',
    };
    stubApi({
      'GET /api/v1/users': () => json({ items: [admin, vera] }),
      [`PATCH /api/v1/users/${REVIEWER.id}`]: (init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        patches.push({ id: REVIEWER.id, body });
        return json({
          ...vera,
          ...body,
        });
      },
    });

    renderAt('/admin/users');

    // Свою строку менять нельзя: селект и кнопка выключены.
    const annaRow = await screen.findByRole('row', { name: /anna \(это вы\)/ });
    expect(
      (within(annaRow).getByRole('combobox', { name: 'Роль: anna' }) as HTMLSelectElement).disabled,
    ).toBe(true);
    expect(
      (within(annaRow).getByRole('button', { name: 'Отключить' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    // Роль Веры поднимается до администратора: PATCH уходит с ролью.
    fireEvent.change(await screen.findByRole('combobox', { name: 'Роль: vera' }), {
      target: { value: 'admin' },
    });
    await waitFor(() => expect(patches).toEqual([{ id: REVIEWER.id, body: { role: 'admin' } }]));

    // Отключение: PATCH с disabled и статус в таблице меняется.
    fireEvent.click(
      within(screen.getByRole('row', { name: /vera/ })).getByRole('button', { name: 'Отключить' }),
    );
    await waitFor(() => expect(patches[1]).toEqual({ id: REVIEWER.id, body: { disabled: true } }));
    expect(screen.getByRole('row', { name: /vera/ }).textContent).toContain('отключён');
  });

  it('показатели пилота доступны администратору', async () => {
    stubApi({
      'GET /api/v1/pilot/metrics': () =>
        json({
          period: { from: null, to: null },
          articles: {
            total: 2,
            approved: 1,
            reviewed: 1,
            approvalMedianHours: 26.5,
            approvedWithoutReturn: 1,
            approvedWithoutReturnShare: 1,
            gateCaught: 1,
            gateCaughtBeforeReviewShare: 1,
            withGeneratedVersion: 1,
            textChangedAfterGeneration: 1,
            textChangedAfterGenerationShare: 1,
            averageRating: 5,
            ratedArticles: 1,
            averageRubric: { accuracy: 5, style: 4, readability: 5, hooks: 3, cliches: 4 },
            rubricRatedArticles: 1,
          },
          generation: {
            runs: 2,
            succeeded: 1,
            needsInput: 1,
            failed: 0,
            cancelled: 0,
            needsInputShare: 0.5,
            failureShare: 0,
            questions: [{ question: 'Нужен источник', count: 1 }],
            costUsd: 0.2,
            costPerArticle: 0.2,
          },
        }),
    });

    renderAt('/admin/pilot');

    expect(await screen.findByRole('heading', { name: 'Показатели пилота' })).toBeTruthy();
    expect(await screen.findByText('26,5 ч')).toBeTruthy();
    expect(screen.getByText('Нужен источник')).toBeTruthy();
    expect(screen.getByText('5,0 / 5')).toBeTruthy();
    expect(screen.getByText('1 оценка по шкале 1–5')).toBeTruthy();
    expect(
      screen.getByText(/Рубрика редактора \(1 оценка\): точность 5,0 \/ 5 · .*· штампы 4,0 \/ 5/),
    ).toBeTruthy();
    expect(screen.getAllByText(/0,20/)).toHaveLength(2);
  });

  it('журнал аудита доступен администратору', async () => {
    stubApi({
      'GET /api/v1/audit': () =>
        json({
          items: [
            {
              id: 3,
              actorId: ADMIN.id,
              actorLogin: 'anna',
              actorName: 'Анна Иванова',
              action: 'article.transition',
              entityType: 'article',
              entityId: '00000000-0000-4000-8000-00000000a1',
              payload: { from: 'drafting', to: 'in_review' },
              createdAt: '2026-10-25T09:00:00.000Z',
            },
            {
              id: 2,
              actorId: null,
              actorLogin: null,
              actorName: null,
              action: 'auth.denied',
              entityType: 'user',
              entityId: '',
              payload: {},
              createdAt: '2026-10-24T09:00:00.000Z',
            },
          ],
          truncated: true,
        }),
    });

    renderAt('/admin/audit');

    expect(await screen.findByRole('heading', { name: 'Журнал аудита' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Аудит' })).toBeTruthy();
    // Ждём строку таблицы: подпись действия есть и в выпадающем списке фильтра,
    // поэтому ориентируемся на детали записи.
    expect(await screen.findByText(/from: drafting/)).toBeTruthy();
    expect(screen.getByText(/Показаны последние 500 записей/)).toBeTruthy();
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

  it('факт-база: карточка показывает, где факт используется', async () => {
    stubApi(
      {
        'GET /api/v1/facts': () => json({ items: [factItem()], truncated: false }),
        [`GET /api/v1/facts/${FACT_ID}/usage`]: () =>
          json({
            items: [
              {
                articleId: ARTICLE_ID,
                topic: 'Агенты на длинных задачах',
                status: 'in_review',
                updatedAt: '2026-10-25T12:00:00.000Z',
              },
            ],
            truncated: false,
          }),
      },
      REVIEWER,
    );

    renderAt('/facts');

    fireEvent.click(await screen.findByRole('button', { name: 'Где используется' }));
    expect(await screen.findByText('Привязок: 1')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Агенты на длинных задачах' })).toBeTruthy();
    expect(screen.getByText(/Правка этого факта повлияет/)).toBeTruthy();
  });

  it('факт-база: фильтр по продукту уходит в запрос', async () => {
    const fetchMock = stubApi({ 'GET /api/v1/products': () => json({ items: [PRODUCT] }) }, AUTHOR);

    renderAt('/facts');

    // Опция появляется после загрузки каталога: иначе select не примет значение.
    const option = await screen.findByRole('option', { name: 'Демо-продукт' });
    const select = option.closest('select');
    if (!select) {
      throw new Error('Селект продукта не найден');
    }
    fireEvent.change(select, { target: { value: PRODUCT.id } });
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes(`productId=${PRODUCT.id}`)),
      ).toBe(true),
    );
  });

  it('факт-база: исправление одобренного факта предупреждает о последствиях', async () => {
    stubApi(
      {
        'GET /api/v1/facts': () =>
          json({
            items: [
              factItem({
                status: 'approved',
                approvedBy: { id: REVIEWER.id, login: 'boris', name: null },
                approvedAt: '2026-10-21T10:00:00.000Z',
                actions: { ...FACT_ACTIONS, correct: ALLOWED },
              }),
            ],
            truncated: false,
          }),
      },
      REVIEWER,
    );

    renderAt('/facts');

    fireEvent.click(await screen.findByRole('button', { name: 'Исправить' }));
    expect(await screen.findByText(/Исправление не переписывает историю/)).toBeTruthy();
    expect(screen.getByText(/текущий перейдёт в «заменён»/)).toBeTruthy();
  });

  it('факт-база: отзыв согласия предупреждает о привязанных материалах', async () => {
    stubApi(
      {
        'GET /api/v1/facts': () =>
          json({
            items: [
              factItem({
                type: 'experience_note',
                consentConfirmed: true,
                anonymized: true,
                actions: { ...FACT_ACTIONS, confirmConsent: ALLOWED, withdrawConsent: ALLOWED },
              }),
            ],
            truncated: false,
          }),
      },
      REVIEWER,
    );

    renderAt('/facts');

    fireEvent.click(await screen.findByRole('button', { name: 'Отозвать согласие' }));
    expect(await screen.findByText(/Материалы, где заметка привязана/)).toBeTruthy();
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

    fireEvent.change(await screen.findByLabelText('Факт', { exact: true }, { timeout: 5000 }), {
      target: { value: FACT_ID },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Привязать' }));

    expect(await screen.findByText('F1 · Источник новости · Одобрен')).toBeTruthy();
    expect(posted).toEqual([{ factId: FACT_ID }]);
  });

  it('панель генерации показывает причину, когда фактов не хватает', async () => {
    stubApi();

    renderAt(`/articles/${ARTICLE_ID}`);

    const button = await screen.findByRole('button', { name: 'Сгенерировать' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Не хватает: Одобренные факты/)).toBeTruthy();
  });

  it('панель проверок показывает блокирующую проверку и позволяет подтвердить', async () => {
    const posted: unknown[] = [];
    const withChecks = {
      ...DETAIL,
      currentVersionNumber: 3,
      checks: [
        {
          id: 'numbers_must_map_to_facts',
          severity: 'block',
          message: '«42» не найдено в фактах',
          start: 10,
          end: 12,
          excerpt: '42',
        },
      ],
    };
    stubApi({
      [`GET /api/v1/articles/${ARTICLE_ID}`]: () => json(withChecks),
      [`GET /api/v1/articles/${ARTICLE_ID}/versions/3`]: () =>
        json(
          versionDetail({
            number: 3,
            title: 'Текст с проверкой',
            articleMarkdown: 'Текст с числом 42.',
            checks: withChecks.checks,
          }),
        ),
      [`POST /api/v1/articles/${ARTICLE_ID}/versions/3/checks/0/confirm`]: (init) => {
        posted.push(JSON.parse(String(init?.body)));
        return json({
          ...withChecks,
          checks: [
            {
              ...withChecks.checks[0],
              decision: 'confirmed',
              comment: 'Это номер пункта правил.',
            },
          ],
        });
      },
    });

    renderAt(`/articles/${ARTICLE_ID}`);

    expect(await screen.findByText('«42» не найдено в фактах')).toBeTruthy();
    expect(screen.getByText('Блокирующих проверок: 1. Материал не пройдёт на ревью')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }));
    fireEvent.change(await screen.findByLabelText('Почему проверку можно снять'), {
      target: { value: 'Это номер пункта правил.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }));

    await waitFor(() =>
      expect(screen.getByText('Комментарий автора: Это номер пункта правил.')).toBeTruthy(),
    );
    expect(posted).toEqual([{ comment: 'Это номер пункта правил.' }]);
  });

  it('ревьюер читает текст, утверждения и привязанные факты', async () => {
    const version = versionDetail({
      number: 2,
      origin: 'generated',
      title: 'Как агенты работают на длинных задачах',
      articleMarkdown: 'Текст статьи для ревью.',
      claims: [
        {
          text: 'Точность ответов выросла на 20 %',
          type: 'fact',
          factIds: ['F1'],
        },
      ],
    });
    const fact = {
      factId: FACT_ID,
      label: 'F1',
      type: 'company_fact',
      status: 'approved',
      text: 'Команда измеряет точность ответов на эталонном наборе',
      sourceName: null,
      sourceUrl: null,
      sourcePublishedAt: null,
    };
    stubApi(
      {
        [`GET /api/v1/articles/${ARTICLE_ID}`]: () =>
          json({
            ...DETAIL,
            status: 'in_review',
            owner: AUTHOR,
            reviewer: REVIEWER,
            currentVersionNumber: 2,
            facts: [fact],
          }),
        [`GET /api/v1/articles/${ARTICLE_ID}/versions/2`]: () => json(version),
      },
      REVIEWER,
    );

    renderAt(`/articles/${ARTICLE_ID}`);

    expect(
      await screen.findByRole('heading', { name: 'Текст материала' }, { timeout: 5000 }),
    ).toBeTruthy();
    expect(await screen.findByText('Текст статьи для ревью.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Утверждения' })).toBeTruthy();
    expect(screen.getByText('Точность ответов выросла на 20 %')).toBeTruthy();
    expect(screen.getByText(/Одобрен: Команда измеряет точность/)).toBeTruthy();
    expect(screen.getByText('Метаданные публикации')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Читать текст' }).getAttribute('href')).toBe(
      '#article-text',
    );
    expect(screen.queryByRole('link', { name: 'Редактировать текст' })).toBeNull();
  });

  it('метрики показывают сравнение материалов и принимают ручной ввод', async () => {
    const posted: unknown[] = [];
    stubApi({
      'GET /api/v1/metrics': () =>
        json({
          items: [
            {
              id: '22222222-2222-4222-8222-222222222222',
              articleId: ARTICLE_ID,
              topic: 'Агенты на длинных задачах',
              externalUrl: 'https://dzen.ru/a/demo',
              capturedOn: '2026-11-02',
              views: 1500,
              reads: 450,
              avgReadSeconds: 90,
              source: 'manual',
              createdAt: '2026-11-02T10:00:00.000Z',
              createdBy: 'anna',
            },
            {
              id: '33333333-3333-4333-8333-333333333333',
              articleId: ARTICLE_ID,
              topic: 'Агенты на длинных задачах',
              externalUrl: 'https://dzen.ru/a/demo',
              capturedOn: '2026-11-01',
              views: 1000,
              reads: 300,
              avgReadSeconds: 80,
              source: 'manual',
              createdAt: '2026-11-01T10:00:00.000Z',
              createdBy: 'anna',
            },
          ],
        }),
      'GET /api/v1/publications': () =>
        json({
          items: [
            {
              articleId: ARTICLE_ID,
              topic: 'Агенты на длинных задачах',
              styleName: 'Новости индустрии',
              status: 'published',
              version: 3,
              currentVersionNumber: 2,
              plannedAt: null,
              publishedAt: '2026-11-01T10:00:00.000Z',
              externalUrl: 'https://dzen.ru/a/demo',
              canExport: true,
            },
          ],
        }),
      'POST /api/v1/metrics': (init) => {
        posted.push(JSON.parse(String(init?.body)));
        return json({
          snapshot: {
            id: '44444444-4444-4444-8444-444444444444',
            articleId: ARTICLE_ID,
            topic: 'Агенты на длинных задачах',
            externalUrl: 'https://dzen.ru/a/demo',
            capturedOn: '2026-11-03',
            views: 2000,
            reads: 460,
            avgReadSeconds: null,
            source: 'manual',
            createdAt: '2026-11-03T10:00:00.000Z',
            createdBy: 'anna',
          },
          warnings: [],
        });
      },
      'POST /api/v1/metrics/import': () =>
        json({ imported: 1, updated: 0, skipped: [], warnings: [] }),
    });

    renderAt('/metrics');

    expect(await screen.findByText('Сравнение материалов')).toBeTruthy();
    // Прирост за день считается как разница с предыдущим снимком.
    expect(screen.getByText('+500 за день')).toBeTruthy();
    expect(screen.getByText('30%')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Материал'), { target: { value: ARTICLE_ID } });
    fireEvent.change(screen.getByLabelText('Просмотры'), { target: { value: '2000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Внести метрики' }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ articleId: ARTICLE_ID, views: 2000 });
    // Форма остаётся на экране во время тихой перезагрузки данных.
    expect(screen.getByLabelText('Материал')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Содержимое файла'), {
      target: { value: 'url,captured_on,views,reads\nhttps://dzen.ru/a/demo,2026-11-03,10,2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Импортировать' }));

    expect(await screen.findByText(/Импортировано/)).toBeTruthy();
  });

  it('публикации показывают материалы, пакет и отметку публикации', async () => {
    const posted: unknown[] = [];
    stubApi({
      'GET /api/v1/publications': () =>
        json({
          items: [
            {
              articleId: ARTICLE_ID,
              topic: 'Агенты на длинных задачах',
              styleName: 'Новости индустрии',
              status: 'approved',
              version: 3,
              currentVersionNumber: 2,
              plannedAt: '2026-11-01T09:00:00.000Z',
              publishedAt: null,
              externalUrl: null,
              canExport: true,
            },
          ],
        }),
      [`POST /api/v1/articles/${ARTICLE_ID}/transitions`]: (init) => {
        posted.push(JSON.parse(String(init?.body)));
        return json(DETAIL);
      },
    });

    renderAt('/publications');

    expect(await screen.findByText('Агенты на длинных задачах')).toBeTruthy();
    const download = screen.getByRole('link', { name: 'Скачать пакет' });
    expect(download.getAttribute('href')).toBe(`/api/v1/publications/${ARTICLE_ID}/export`);

    fireEvent.change(screen.getByLabelText('Ссылка на статью в Дзене'), {
      target: { value: 'https://dzen.ru/a/demo' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Отметить публикацию' }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      to: 'published',
      expectedVersion: 3,
      externalUrl: 'https://dzen.ru/a/demo',
    });
  });

  it('редактор показывает исходник, предпросмотр и панель проверок', async () => {
    const version = {
      number: 2,
      origin: 'generated',
      title: 'Заголовок статьи',
      articleMarkdown: 'Первый абзац.\n\nВторой абзац.',
      seoTitle: 'SEO',
      tags: ['ии'],
      description: 'Описание',
      imagePrompt: 'Обложка',
      advertisingLabel: false,
      disclaimerText: null,
      claims: [{ text: 'Первый абзац.', type: 'fact', factIds: ['F1'], start: 0, end: 12 }],
      checks: [
        {
          id: 'numbers_must_map_to_facts',
          severity: 'block',
          message: '«42» не найдено в фактах',
          start: 0,
          end: 2,
          excerpt: '42',
        },
      ],
      styleVersion: 1,
      promptVersion: 'sha256:test',
      generationRunId: null,
      createdAt: '2026-10-22T10:00:00.000Z',
      createdBy: 'anna',
    };
    stubApi({
      [`GET /api/v1/articles/${ARTICLE_ID}`]: () => json({ ...DETAIL, currentVersionNumber: 2 }),
      [`GET /api/v1/articles/${ARTICLE_ID}/versions`]: () =>
        json({
          items: [
            {
              number: 2,
              origin: 'generated',
              advertisingLabel: false,
              blockingChecks: 1,
              createdAt: '2026-10-22T10:00:00.000Z',
              createdBy: 'anna',
            },
          ],
        }),
      [`GET /api/v1/articles/${ARTICLE_ID}/versions/2`]: () => json(version),
      [`POST /api/v1/articles/${ARTICLE_ID}/versions/check`]: () =>
        json({ checks: version.checks, claims: version.claims }),
    });

    renderAt(`/articles/${ARTICLE_ID}/edit`);

    // Редактор грузится отдельным чанком: даём динамическому импорту время.
    expect(await screen.findByRole('region', { name: 'Исходник' }, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Предпросмотр' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Проверки' })).toBeTruthy();
    expect(await screen.findByText('«42» не найдено в фактах')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Сохранить версию' })).toBeTruthy();
  });

  it('редактор автосохраняет черновик в localStorage', async () => {
    const version = versionDetail({
      number: 2,
      title: 'Заголовок статьи',
      articleMarkdown: 'Первый абзац.',
    });
    stubApi({
      [`GET /api/v1/articles/${ARTICLE_ID}`]: () => json({ ...DETAIL, currentVersionNumber: 2 }),
      [`GET /api/v1/articles/${ARTICLE_ID}/versions`]: () =>
        json({
          items: [
            {
              number: 2,
              origin: 'generated',
              advertisingLabel: false,
              blockingChecks: 0,
              createdAt: '2026-10-22T10:00:00.000Z',
              createdBy: 'anna',
            },
          ],
        }),
      [`GET /api/v1/articles/${ARTICLE_ID}/versions/2`]: () => json(version),
      [`POST /api/v1/articles/${ARTICLE_ID}/versions/check`]: () =>
        json({ checks: version.checks, claims: version.claims }),
    });

    renderAt(`/articles/${ARTICLE_ID}/edit`);

    await screen.findByRole('region', { name: 'Исходник' }, { timeout: 5000 });
    fireEvent.change(screen.getByLabelText('Заголовок'), {
      target: { value: 'Новый заголовок' },
    });

    expect(await screen.findByText(/Черновик сохранён локально/)).toBeTruthy();
    const stored = window.localStorage.getItem(`dzenwriter:draft:${ARTICLE_ID}`);
    expect(stored).not.toBeNull();
    expect(stored).toContain('Новый заголовок');

    cleanup();
    renderAt(`/articles/${ARTICLE_ID}/edit`);
    await screen.findByRole('region', { name: 'Исходник' }, { timeout: 5000 });
    expect(await screen.findByText(/Восстановлен локальный черновик/)).toBeTruthy();
    expect((screen.getByLabelText('Заголовок') as HTMLInputElement).value).toBe('Новый заголовок');
  });

  it('конфликт версий показывает diff и перезагружает серверную версию', async () => {
    const localVersion = versionDetail({
      number: 2,
      title: 'Локальный заголовок',
      articleMarkdown: 'Локальный текст.',
    });
    const latestVersion = versionDetail({
      number: 3,
      title: 'Серверный заголовок',
      articleMarkdown: 'Серверный текст.',
    });
    let articleCalls = 0;
    stubApi({
      [`GET /api/v1/articles/${ARTICLE_ID}`]: () => {
        articleCalls += 1;
        return json({
          ...DETAIL,
          currentVersionNumber: articleCalls === 1 ? 2 : 3,
          version: articleCalls === 1 ? 1 : 2,
        });
      },
      [`GET /api/v1/articles/${ARTICLE_ID}/versions`]: () =>
        json({
          items: [
            {
              number: 2,
              origin: 'generated',
              advertisingLabel: false,
              blockingChecks: 0,
              createdAt: '2026-10-22T10:00:00.000Z',
              createdBy: 'anna',
            },
            {
              number: 3,
              origin: 'manual',
              advertisingLabel: false,
              blockingChecks: 0,
              createdAt: '2026-10-22T11:00:00.000Z',
              createdBy: 'anna',
            },
          ],
        }),
      [`GET /api/v1/articles/${ARTICLE_ID}/versions/2`]: () => json(localVersion),
      [`GET /api/v1/articles/${ARTICLE_ID}/versions/3`]: () => json(latestVersion),
      [`POST /api/v1/articles/${ARTICLE_ID}/versions/check`]: () =>
        json({ checks: localVersion.checks, claims: localVersion.claims }),
      [`POST /api/v1/articles/${ARTICLE_ID}/versions`]: () =>
        json(
          {
            type: 'about:blank',
            title: 'Conflict',
            status: 409,
            detail: 'Материал изменился, пока вы его смотрели',
          },
          409,
        ),
    });

    renderAt(`/articles/${ARTICLE_ID}/edit`);

    await screen.findByRole('region', { name: 'Исходник' }, { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить версию' }));

    expect(await screen.findByRole('heading', { name: 'Материал изменили' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Сравнить' }));
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByText('Серверный текст.')).toBeTruthy();
    expect(within(dialog).getByText('Локальный текст.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Перезагрузить' }));
    expect(screen.queryByRole('heading', { name: 'Материал изменили' })).toBeNull();
    expect((screen.getByLabelText('Заголовок') as HTMLInputElement).value).toBe(
      'Серверный заголовок',
    );
  });

  it('генерация показывает стадии и вопросы модели, из вопроса можно добавить факт', async () => {
    const postedFact: unknown[] = [];
    const postedAttach: unknown[] = [];
    const createdFact = factItem({
      type: 'news_source',
      status: 'draft',
      text: 'Новый источник',
      sourceName: 'Новый источник',
      sourceUrl: 'https://example.com/news/2',
      sourcePublishedAt: '2026-10-20',
    });
    const factLink = {
      factId: FACT_ID,
      label: 'F1',
      type: 'news_source',
      status: 'draft',
      text: 'Новый источник',
      sourceName: 'Новый источник',
      sourceUrl: 'https://example.com/news/2',
      sourcePublishedAt: '2026-10-20',
    };
    stubApi({
      [`GET /api/v1/articles/${ARTICLE_ID}`]: () =>
        json({
          ...DETAIL,
          generation: { allowed: true, reason: null, outOfFocus: false, confirmed: false },
        }),
      'POST /api/v1/facts': (init) => {
        postedFact.push(JSON.parse(String(init?.body)));
        return json(createdFact);
      },
      [`POST /api/v1/articles/${ARTICLE_ID}/facts`]: (init) => {
        postedAttach.push(JSON.parse(String(init?.body)));
        return json({ ...DETAIL, facts: [factLink] });
      },
      [`POST /api/v1/articles/${ARTICLE_ID}/generations`]: () =>
        sse([
          {
            event: 'stage',
            data: { type: 'stage', stage: { stage: 'generate', status: 'running' } },
          },
          {
            event: 'stage',
            data: {
              type: 'stage',
              stage: { stage: 'parse', status: 'done', message: 'Ответ соответствует схеме' },
            },
          },
          {
            event: 'result',
            data: {
              type: 'result',
              result: {
                runId: '00000000-0000-4000-8000-0000000000b1',
                status: 'needs_input',
                versionNumber: null,
                inputTokens: 10,
                outputTokens: 20,
                latencyMs: 100,
                questions: ['Какой результат вы получили?'],
                errorCode: null,
              },
            },
          },
        ]),
    });

    renderAt(`/articles/${ARTICLE_ID}`);

    fireEvent.click(await screen.findByRole('button', { name: 'Сгенерировать' }));

    expect(await screen.findByText('Какой результат вы получили?')).toBeTruthy();
    expect(screen.getByText('Сборка промпта')).toBeTruthy();
    expect(screen.getByText('Разбор ответа')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Добавить факт' }));
    expect(await screen.findByRole('heading', { name: 'Добавить факт' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Текст факта или цитаты'), {
      target: { value: 'Новый источник' },
    });
    fireEvent.change(screen.getByLabelText('Название источника'), {
      target: { value: 'Новый источник' },
    });
    fireEvent.change(screen.getByLabelText('Ссылка на источник (обязательна)'), {
      target: { value: 'https://example.com/news/2' },
    });
    fireEvent.change(screen.getByLabelText('Дата публикации источника (обязательна)'), {
      target: { value: '2026-10-20' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить факт' }));

    expect(await screen.findByText(/Факт «Источник новости» добавлен и привязан/)).toBeTruthy();
    expect(postedFact[0]).toMatchObject({ type: 'news_source', text: 'Новый источник' });
    expect(postedAttach[0]).toEqual({ factId: FACT_ID });
  });
});
