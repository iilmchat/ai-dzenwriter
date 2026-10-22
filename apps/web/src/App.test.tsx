import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

const READY = { status: 'ready', checks: { database: 'ok' } };
const ANNA = {
  id: '00000000-0000-4000-8000-000000000001',
  login: 'anna',
  name: 'Анна Иванова',
  role: 'admin',
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Заглушки по адресу и методу: приложение делает запросы к /ready, /api/v1/me и выходу.
function stubApi(routes: Record<string, () => Response | Promise<Response>>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input)}`;
    const route = routes[key];
    if (!route) {
      throw new Error(`Нет заглушки для ${key}`);
    }
    return route();
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const ANONYMOUS = () => jsonResponse({ type: 'about:blank', status: 401 }, 401);

function statusText(): string | null {
  return screen.getByRole('status').textContent;
}

describe('App', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.replaceState(null, '', '/');
  });

  it('показывает, что сервис готов, и предлагает войти', async () => {
    stubApi({
      'GET /ready': () => jsonResponse(READY, 200),
      'GET /api/v1/me': ANONYMOUS,
    });

    render(<App />);

    await waitFor(() => expect(statusText()).toBe('Сервис готов'));
    const login = screen.getByRole('link', { name: 'Войти через GitHub' });
    expect(login.getAttribute('href')).toBe('/api/v1/auth/github/start');
  });

  it('показывает недоступность базы из ответа /ready', async () => {
    stubApi({
      'GET /ready': () =>
        jsonResponse({ status: 'unavailable', checks: { database: 'error' } }, 503),
      'GET /api/v1/me': ANONYMOUS,
    });

    render(<App />);

    await waitFor(() => expect(statusText()).toBe('Сервис недоступен: база данных не отвечает'));
  });

  it('показывает ошибку сети при проверке готовности', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === '/ready') {
          throw new TypeError('network down');
        }
        return jsonResponse({}, 401);
      }),
    );

    render(<App />);

    await waitFor(() => expect(statusText()).toBe('Сервис недоступен: сервис не отвечает'));
  });

  it('объясняет отказ по членству, который пришёл в адресе после входа', async () => {
    window.history.replaceState(null, '', '/?error=not_member');
    stubApi({
      'GET /ready': () => jsonResponse(READY, 200),
      'GET /api/v1/me': ANONYMOUS,
    });

    render(<App />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Вход доступен только участникам организации iilmchat');
    expect(window.location.search).toBe('');
  });

  it('вошедший видит имя и роль, выход возвращает экран входа', async () => {
    const fetchMock = stubApi({
      'GET /ready': () => jsonResponse(READY, 200),
      'GET /api/v1/me': () => jsonResponse(ANNA, 200),
      'POST /api/v1/auth/logout': () => new Response(null, { status: 204 }),
    });

    render(<App />);

    const greeting = await screen.findByText(/Вы вошли как/);
    expect(greeting.textContent).toContain('Анна Иванова');
    expect(greeting.textContent).toContain('Администратор');

    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));

    await screen.findByRole('link', { name: 'Войти через GitHub' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/logout',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
