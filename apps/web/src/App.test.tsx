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
const ARTICLE_ID = '00000000-0000-4000-8000-0000000000a1';

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
});
