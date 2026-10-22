import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function statusText(): string | null {
  return screen.getByRole('status').textContent;
}

describe('App', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('показывает, что сервис готов', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ status: 'ready', checks: { database: 'ok' } }, 200)),
    );

    render(<App />);

    await waitFor(() => expect(statusText()).toBe('Сервис готов'));
  });

  it('показывает недоступность базы из ответа /ready', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ status: 'unavailable', checks: { database: 'error' } }, 503),
        ),
    );

    render(<App />);

    await waitFor(() => expect(statusText()).toBe('Сервис недоступен: база данных не отвечает'));
  });

  it('показывает ошибку сети', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')));

    render(<App />);

    await waitFor(() => expect(statusText()).toBe('Сервис недоступен: сервис не отвечает'));
  });
});
