import type { ReviewComment } from '@dzenwriter/shared';
import { useEffect, useState } from 'react';
import { errorMessage } from '../../api/client';
import { fetchReviewComments, resolveReviewComment } from '../../api/reviews';
import { formatDateTime } from '../../lib/format';
import { BUTTON_SECONDARY, PANEL_CLASS } from '../../shared/ui/classes';
import { Notice } from '../../shared/ui/Notice';

export interface ReviewCommentsPanelProps {
  readonly articleId: string;
  readonly versionNumber: number | null;
  readonly canResolve: boolean;
  readonly onFocus?: (comment: ReviewComment) => void;
  // Меняется после создания комментария: панель перечитывает список.
  readonly refreshKey?: number;
}

// Боковая панель комментариев к текущей версии: неразрешённые идут первыми.
export function ReviewCommentsPanel({
  articleId,
  versionNumber,
  canResolve,
  onFocus,
  refreshKey = 0,
}: ReviewCommentsPanelProps) {
  const [items, setItems] = useState<readonly ReviewComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [resolving, setResolving] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (versionNumber === null) {
      setItems([]);
      return;
    }
    let active = true;
    setLoading(true);
    setError(undefined);
    fetchReviewComments(articleId, versionNumber).then(
      (response) => {
        if (active) {
          setItems(response.items);
          setLoading(false);
        }
      },
      (cause: unknown) => {
        if (active) {
          setError(errorMessage(cause));
          setLoading(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [articleId, versionNumber, refreshKey]);

  async function resolve(comment: ReviewComment) {
    if (versionNumber === null) {
      return;
    }
    setResolving(comment.id);
    setError(undefined);
    try {
      const response = await resolveReviewComment(articleId, versionNumber, comment.id);
      setItems(response.items);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setResolving(undefined);
    }
  }

  return (
    <aside aria-labelledby="review-comments-title" className={PANEL_CLASS}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="review-comments-title" className="font-display text-lg font-bold">
          Комментарии ревьюеров
        </h2>
        {versionNumber !== null ? (
          <span className="text-xs text-on-surface-variant">версия {versionNumber}</span>
        ) : null}
      </div>

      {versionNumber === null ? (
        <p className="mt-3 text-sm text-on-surface-variant">
          Текст текущей версии ещё не сохранён.
        </p>
      ) : null}
      {loading ? (
        <p className="mt-3 text-sm text-on-surface-variant">Загружаем комментарии…</p>
      ) : null}
      {error !== undefined ? (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}
      {versionNumber !== null && !loading && items.length === 0 ? (
        <p className="mt-3 text-sm text-on-surface-variant">Комментариев пока нет.</p>
      ) : null}

      {items.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-3">
          {items.map((item) => {
            const content = (
              <>
                <span
                  className={`block rounded-lg border-l-4 border-primary bg-surface p-2 text-sm text-on-surface-variant ${
                    item.isResolved ? '' : 'font-semibold'
                  }`}
                >
                  {item.selectedText}
                </span>
                <span className={`mt-2 block text-sm ${item.isResolved ? '' : 'font-semibold'}`}>
                  {item.comment}
                </span>
                <span className="mt-1 block text-xs text-on-surface-variant">
                  {item.reviewerName}, {formatDateTime(item.createdAt)}
                </span>
              </>
            );
            return (
              <li
                key={item.id}
                className={`rounded-xl border p-3 ${
                  item.isResolved ? 'border-outline-variant opacity-70' : 'border-primary'
                }`}
              >
                {onFocus !== undefined ? (
                  <button type="button" className="w-full text-left" onClick={() => onFocus(item)}>
                    {content}
                  </button>
                ) : (
                  content
                )}
                <div className="mt-2 flex items-center gap-2">
                  {item.isResolved ? (
                    <span className="text-xs font-medium text-on-surface-variant">Решено</span>
                  ) : canResolve ? (
                    <button
                      type="button"
                      className={`${BUTTON_SECONDARY} px-3 py-1.5 text-xs`}
                      disabled={resolving === item.id}
                      onClick={() => void resolve(item)}
                    >
                      Решено
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </aside>
  );
}
