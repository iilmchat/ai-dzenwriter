import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../api/notifications';
import { NotificationsPanel } from './NotificationsPanel';

vi.mock('../../api/notifications', () => ({
  fetchNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));

const mockedFetch = vi.mocked(fetchNotifications);
const mockedMark = vi.mocked(markNotificationRead);
const mockedMarkAll = vi.mocked(markAllNotificationsRead);

const ARTICLE_ID = '00000000-0000-4000-8000-0000000000a1';
const UNREAD = {
  id: '00000000-0000-4000-8000-000000000001',
  type: 'article_approved' as const,
  message: 'Статья утверждена: тема',
  entityId: ARTICLE_ID,
  isRead: false,
  createdAt: '2026-10-22T10:00:00.000Z',
};
const READ = {
  ...UNREAD,
  id: '00000000-0000-4000-8000-000000000002',
  type: 'article_returned' as const,
  message: 'Статья возвращена на доработку: тема',
  isRead: true,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPanel() {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<NotificationsPanel />} />
        <Route path={`/articles/${ARTICLE_ID}`} element={<p>Страница статьи</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('панель уведомлений', () => {
  it('показывает бейдж и список с непрочитанными жирным', async () => {
    mockedFetch.mockResolvedValue({ items: [UNREAD, READ], unreadCount: 1 });
    renderPanel();

    const bell = screen.getByRole('button', { name: 'Уведомления' });
    await waitFor(() => expect(bell.textContent).toContain('1'));

    fireEvent.click(bell);

    expect(await screen.findByText(UNREAD.message)).toBeTruthy();
    expect(screen.getByText(READ.message)).toBeTruthy();
    expect(screen.getByRole('button', { name: new RegExp(UNREAD.message) }).className).toContain(
      'font-semibold',
    );
    expect(screen.getByRole('button', { name: new RegExp(READ.message) }).className).not.toContain(
      'font-semibold',
    );
  });

  it('по клику отмечает прочитанным и открывает материал', async () => {
    mockedFetch.mockResolvedValue({ items: [UNREAD], unreadCount: 1 });
    mockedMark.mockResolvedValue({ items: [{ ...UNREAD, isRead: true }], unreadCount: 0 });
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Уведомления' }));
    fireEvent.click(await screen.findByText(UNREAD.message));

    await waitFor(() => expect(mockedMark).toHaveBeenCalledWith(UNREAD.id));
    expect(await screen.findByText('Страница статьи')).toBeTruthy();
  });

  it('кнопка «Прочитать все» вызывает bulk-метод', async () => {
    mockedFetch.mockResolvedValue({ items: [UNREAD], unreadCount: 1 });
    mockedMarkAll.mockResolvedValue({ items: [{ ...UNREAD, isRead: true }], unreadCount: 0 });
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Уведомления' }));
    await screen.findByText(UNREAD.message);
    fireEvent.click(screen.getByRole('button', { name: 'Прочитать все' }));

    await waitFor(() => expect(mockedMarkAll).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Прочитать все' }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );
  });
});
