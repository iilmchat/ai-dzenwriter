import type { NotificationsResponse } from '@dzenwriter/shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../api/notifications';
import { errorMessage } from '../../api/client';
import { formatDateTime } from '../../lib/format';
import { BUTTON_SECONDARY, FOCUS_RING } from '../../shared/ui/classes';

const REFRESH_INTERVAL_MS = 30_000;

const EMPTY: NotificationsResponse = { items: [], unreadCount: 0 };

// Колокольчик в шапке: счётчик непрочитанных и выпадающая панель.
// Обновление опросом раз в 30 секунд, без WebSocket и внешних сервисов.
export function NotificationsPanel() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<NotificationsResponse>(EMPTY);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const load = () => {
      fetchNotifications().then(
        (response) => {
          if (active) {
            setData(response);
            setError(undefined);
          }
        },
        (cause: unknown) => {
          if (active) {
            setError(errorMessage(cause));
          }
        },
      );
    };
    load();
    const timer = window.setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  async function openNotification(id: string, entityId: string, isRead: boolean) {
    setOpen(false);
    if (!isRead) {
      try {
        const response = await markNotificationRead(id);
        setData(response);
      } catch (cause) {
        setError(errorMessage(cause));
      }
    }
    navigate(`/articles/${entityId}`);
  }

  async function markAll() {
    setBusy(true);
    try {
      setData(await markAllNotificationsRead());
      setError(undefined);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Уведомления"
        aria-expanded={open}
        className={`relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-outline-variant ${FOCUS_RING}`}
        onClick={() => setOpen((value) => !value)}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width={20}
          height={20}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
        >
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
          <path d="M10 21h4" />
        </svg>
        {data.unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-primary px-1 text-center text-xs font-semibold text-on-primary">
            {data.unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Уведомления"
          className="absolute right-0 z-50 mt-2 w-80 rounded-2xl border border-outline-variant bg-surface p-4 shadow-lg"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-base font-bold">Уведомления</h2>
            <button
              type="button"
              className={`${BUTTON_SECONDARY} px-3 py-1.5 text-xs`}
              disabled={busy || data.unreadCount === 0}
              onClick={() => void markAll()}
            >
              Прочитать все
            </button>
          </div>

          {error !== undefined ? (
            <p role="alert" className="mt-2 text-xs text-error">
              {error}
            </p>
          ) : null}

          {data.items.length === 0 ? (
            <p className="mt-3 text-sm text-on-surface-variant">Нет уведомлений.</p>
          ) : (
            <ul className="mt-3 flex max-h-96 flex-col gap-1 overflow-auto">
              {data.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-secondary-container ${
                      item.isRead ? '' : 'font-semibold'
                    }`}
                    onClick={() => void openNotification(item.id, item.entityId, item.isRead)}
                  >
                    <span className="block">{item.message}</span>
                    <span className="mt-1 block text-xs font-normal text-on-surface-variant">
                      {formatDateTime(item.createdAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
