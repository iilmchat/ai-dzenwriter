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
    expect(screen.getAllByText(/0,20/)).toHaveLength(2);
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
        return json({ snapshot: { id: '44444444-4444-4444-8444-444444444444' } });
      },
      'POST /api/v1/metrics/import': () => json({ imported: 1, updated: 0, skipped: [] }),
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

  it('генерация показывает стадии и вопросы модели', async () => {
    stubApi({
      [`GET /api/v1/articles/${ARTICLE_ID}`]: () =>
        json({
          ...DETAIL,
          generation: { allowed: true, reason: null, outOfFocus: false, confirmed: false },
        }),
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
  });
});
