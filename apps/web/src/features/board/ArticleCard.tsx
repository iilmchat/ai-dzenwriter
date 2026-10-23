import {
  ARTICLE_FORMAT_LABELS,
  ARTICLE_STATUS_LABELS,
  type ArticleItem,
  type ArticleStatus,
  type PersonRef,
} from '@dzenwriter/shared';
import { Link } from 'react-router';
import { formatDate } from '../../lib/format';
import { FOCUS_RING, INPUT_CLASS } from '../../shared/ui/classes';

export interface MoveOption {
  readonly status: ArticleStatus;
  readonly label: string;
}

interface ArticleCardProps {
  readonly article: ArticleItem;
  readonly nextStep?: string;
  // Перемещение с клавиатуры: select доступен и тогда, когда drag-and-drop неудобен.
  readonly moveOptions?: readonly MoveOption[];
  readonly onMove?: (target: ArticleStatus) => void;
  readonly draggable?: boolean;
  readonly onDragStart?: () => void;
  readonly onDragEnd?: () => void;
}

export function ArticleCard({
  article,
  nextStep,
  moveOptions,
  onMove,
  draggable = false,
  onDragStart,
  onDragEnd,
}: ArticleCardProps) {
  return (
    <li
      draggable={draggable}
      onDragStart={
        draggable
          ? (event) => {
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', article.id);
              onDragStart?.();
            }
          : undefined
      }
      onDragEnd={draggable ? onDragEnd : undefined}
      className={`rounded-xl border border-outline-variant bg-surface p-4 ${
        draggable ? 'cursor-grab active:cursor-grabbing' : ''
      }`}
    >
      <Link
        to={`/articles/${article.id}`}
        className={`font-medium leading-snug hover:underline ${FOCUS_RING}`}
      >
        {article.topic}
      </Link>
      <p className="mt-2 text-sm text-on-surface-variant">
        {article.styleName}, {ARTICLE_FORMAT_LABELS[article.format]}
      </p>
      <div className="mt-2 flex items-center justify-between gap-2 text-sm text-on-surface-variant">
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary-container text-xs font-semibold text-on-secondary-container"
          >
            {initials(article.owner)}
          </span>
          <span className="truncate">{article.owner.name ?? article.owner.login}</span>
        </span>
        <span className="shrink-0">обновлено {formatDate(article.updatedAt)}</span>
      </div>
      {article.plannedAt ? (
        <p className="text-sm text-on-surface-variant">
          Плановая дата: {formatDate(article.plannedAt)}
        </p>
      ) : null}
      <p className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-secondary-container px-2.5 py-1 font-medium text-on-secondary-container">
          {ARTICLE_STATUS_LABELS[article.status]}
        </span>
        {article.currentVersionNumber !== null ? (
          <span>версия {article.currentVersionNumber}</span>
        ) : null}
        {article.reviewer ? <span>ревьюер: {article.reviewer.login}</span> : null}
        {article.blockingChecks > 0 ? (
          <span className="rounded-full bg-error-container px-2.5 py-1 font-medium text-on-error-container">
            {blockingLabel(article.blockingChecks)}
          </span>
        ) : null}
      </p>
      {nextStep ? (
        <p className="mt-3 rounded-lg bg-secondary-container px-3 py-2 text-sm text-on-secondary-container">
          {nextStep}
        </p>
      ) : null}
      {moveOptions && onMove ? (
        <label className="mt-3 flex flex-col gap-1 text-xs font-medium text-on-surface-variant">
          Переместить
          <select
            className={INPUT_CLASS}
            defaultValue=""
            aria-label="Переместить материал"
            onChange={(event) => {
              const target = event.target.value as ArticleStatus;
              event.currentTarget.value = '';
              if (target) {
                onMove(target);
              }
            }}
          >
            <option value="">Выберите колонку</option>
            {moveOptions.map((option) => (
              <option key={option.status} value={option.status}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </li>
  );
}

function initials(person: PersonRef): string {
  const source = (person.name ?? person.login).trim();
  const parts = source.split(/\s+/).filter((part) => part.length > 0);
  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function blockingLabel(count: number): string {
  return count === 1 ? '1 блокирующая' : `${count} блокирующих`;
}
