import { ARTICLE_STATUS_LABELS, type PublicationItem } from '@dzenwriter/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { transitionArticle } from '../api/articles';
import { errorMessage } from '../api/client';
import { exportUrl, fetchPublications } from '../api/publications';
import { formatDate } from '../lib/format';
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  INPUT_CLASS,
  LABEL_CLASS,
  PANEL_CLASS,
} from '../shared/ui/classes';
import { Notice } from '../shared/ui/Notice';

// Публикации: что готово к публикации, что запланировано, что уже вышло.
export function PublicationsPage() {
  const [items, setItems] = useState<PublicationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);

  const load = useCallback(() => {
    setLoading(true);
    fetchPublications().then(
      (response) => {
        setItems(response.items);
        setLoading(false);
      },
      (cause: unknown) => {
        setError(errorMessage(cause));
        setLoading(false);
      },
    );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-bold">Публикации</h1>
        <p className="text-on-surface-variant">
          Публикация вручную: скачайте пакет для Дзена, опубликуйте в редакторе и внесите ссылку на
          статью.
        </p>
      </header>

      {error !== undefined ? <Notice tone="error">{error}</Notice> : null}

      {loading ? (
        <Notice>Загружаем публикации…</Notice>
      ) : items.length === 0 ? (
        <Notice>Пока нечего публиковать: пакет готовится для утверждённых материалов.</Notice>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.articleId}>
              <PublicationCard item={item} onChanged={load} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface PublicationCardProps {
  readonly item: PublicationItem;
  readonly onChanged: () => void;
}

function PublicationCard({ item, onChanged }: PublicationCardProps) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  async function markPublished() {
    if (url.trim().length === 0) {
      setError('Укажите ссылку на статью в Дзене');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await transitionArticle(item.articleId, {
        to: 'published',
        expectedVersion: item.version,
        externalUrl: url.trim(),
      });
      setUrl('');
      onChanged();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={PANEL_CLASS}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            to={`/articles/${item.articleId}`}
            className="font-display text-lg font-bold hover:underline"
          >
            {item.topic}
          </Link>
          <p className="text-sm text-on-surface-variant">
            {item.styleName} · {ARTICLE_STATUS_LABELS[item.status]} ·{' '}
            {item.currentVersionNumber !== null
              ? `версия ${item.currentVersionNumber}`
              : 'без версии'}
          </p>
          {item.plannedAt !== null ? (
            <p className="text-sm text-on-surface-variant">
              Запланировано на {formatDate(item.plannedAt)}
            </p>
          ) : null}
          {item.externalUrl !== null ? (
            <p className="text-sm">
              Опубликовано:{' '}
              <a
                href={item.externalUrl}
                rel="noopener noreferrer"
                target="_blank"
                className="underline"
              >
                {item.externalUrl}
              </a>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {item.canExport ? (
            <a href={exportUrl(item.articleId)} className={BUTTON_PRIMARY} download>
              Скачать пакет
            </a>
          ) : (
            <span className="text-sm text-on-surface-variant">
              Пакет будет готов после утверждения материала
            </span>
          )}
        </div>
      </div>

      {item.status !== 'published' ? (
        <div className="mt-4 flex flex-col gap-2 border-t border-outline-variant pt-4">
          <div className={LABEL_CLASS}>
            <label htmlFor={`url-${item.articleId}`}>Ссылка на статью в Дзене</label>
            <input
              id={`url-${item.articleId}`}
              className={INPUT_CLASS}
              type="url"
              placeholder="https://dzen.ru/a/…"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </div>
          <div>
            <button
              type="button"
              className={BUTTON_SECONDARY}
              disabled={busy}
              onClick={() => void markPublished()}
            >
              {busy ? 'Сохраняем…' : 'Отметить публикацию'}
            </button>
          </div>
        </div>
      ) : null}

      {error !== undefined ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}
