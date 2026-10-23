import {
  ARTICLE_STATUS_LABELS,
  type ArticleItem,
  type ArticleStatus,
  type CreateArticleResponse,
  type PersonRef,
  type UserRole,
} from '@dzenwriter/shared';
import { useEffect, useId, useState } from 'react';
import { fetchArticles, transitionArticle, type BoardFilters as Filters } from '../api/articles';
import { errorMessage } from '../api/client';
import { ArticleCard, type MoveOption } from '../features/board/ArticleCard';
import { BoardFilters } from '../features/board/BoardFilters';
import { CreateArticleForm } from '../features/board/CreateArticleForm';
import { nextStepFor } from '../features/board/nextStep';
import { useCatalog } from '../features/catalog/useCatalog';
import { useSession } from '../session/SessionContext';
import { BUTTON_PRIMARY, FOCUS_RING, PANEL_CLASS } from '../shared/ui/classes';
import { Notice } from '../shared/ui/Notice';

const EMPTY_FILTERS: Filters = {
  styleId: '',
  mine: false,
  plannedFrom: '',
  plannedTo: '',
  includeArchived: false,
};

interface ColumnDefinition {
  readonly title: string;
  readonly statuses: readonly ArticleStatus[];
  // Куда переводить карточку, если её бросили в эту колонку.
  readonly dropStatus: ArticleStatus;
}

// Колонки доски из раздела 3 backlog. «Запланировано» входит в «Утверждено».
const COLUMNS: readonly ColumnDefinition[] = [
  { title: 'Идея', statuses: ['idea'], dropStatus: 'idea' },
  { title: 'Факты', statuses: ['researching'], dropStatus: 'researching' },
  { title: 'Черновик', statuses: ['drafting'], dropStatus: 'drafting' },
  { title: 'Ревью', statuses: ['in_review'], dropStatus: 'in_review' },
  { title: 'Утверждено', statuses: ['approved', 'scheduled'], dropStatus: 'approved' },
  { title: 'Опубликовано', statuses: ['published'], dropStatus: 'published' },
];

const ARCHIVE_COLUMN: ColumnDefinition = {
  title: ARTICLE_STATUS_LABELS.archived,
  statuses: ['archived'],
  dropStatus: 'archived',
};

const MOVE_OPTIONS: readonly MoveOption[] = [...COLUMNS, ARCHIVE_COLUMN].map((column) => ({
  status: column.dropStatus,
  label: column.title,
}));

type BoardState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly items: readonly ArticleItem[]; readonly truncated: boolean }
  | { readonly phase: 'error'; readonly message: string };

interface Confirmation {
  readonly text: string;
  readonly warnings: readonly string[];
}

export function BoardPage() {
  const catalog = useCatalog();
  const { state: session } = useSession();
  const user = session.phase === 'authenticated' ? session.user : undefined;
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [ownerId, setOwnerId] = useState('');
  const [onlyBlocked, setOnlyBlocked] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | undefined>(undefined);
  const [board, setBoard] = useState<BoardState>({ phase: 'loading' });
  const [draggingId, setDraggingId] = useState<string | undefined>(undefined);
  const [dropTarget, setDropTarget] = useState<ArticleStatus | undefined>(undefined);
  const [moveError, setMoveError] = useState<string | undefined>(undefined);
  const [moving, setMoving] = useState(false);
  const filterKey = JSON.stringify(filters);

  useEffect(() => {
    let active = true;
    fetchArticles(JSON.parse(filterKey) as Filters).then(
      (response) => {
        if (active) {
          setBoard({ phase: 'ready', items: response.items, truncated: response.truncated });
        }
      },
      (cause: unknown) => {
        if (active) {
          setBoard({ phase: 'error', message: errorMessage(cause) });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [filterKey, reloadKey]);

  function handleCreated(response: CreateArticleResponse) {
    setCreating(false);
    setConfirmation({
      text: `Материал «${response.article.topic}» создан, статус: ${ARTICLE_STATUS_LABELS[response.article.status]}.`,
      warnings: response.warnings,
    });
    setReloadKey((value) => value + 1);
  }

  const items = board.phase === 'ready' ? board.items : [];
  const owners = uniqueOwners(items);
  const selectedOwner = ownerId === 'mine' ? (user?.id ?? '') : ownerId;
  const visibleItems = items.filter(
    (article) =>
      (selectedOwner === '' || article.owner.id === selectedOwner) &&
      (!onlyBlocked || article.blockingChecks > 0),
  );
  const columns = filters.includeArchived ? [...COLUMNS, ARCHIVE_COLUMN] : COLUMNS;

  async function moveArticle(article: ArticleItem, target: ArticleStatus) {
    if (moving) {
      return;
    }
    const targetColumn = columns.find((column) => column.dropStatus === target);
    const currentColumn = columns.find((column) => column.statuses.includes(article.status));
    if (!targetColumn || currentColumn?.statuses.includes(target)) {
      setDraggingId(undefined);
      setDropTarget(undefined);
      return;
    }

    setMoving(true);
    setMoveError(undefined);
    setDraggingId(undefined);
    setDropTarget(undefined);
    try {
      const updated = await transitionArticle(article.id, {
        to: target,
        expectedVersion: article.version,
      });
      setBoard((current) =>
        current.phase === 'ready'
          ? {
              ...current,
              items: current.items.map((item) => (item.id === updated.id ? updated : item)),
            }
          : current,
      );
    } catch (cause) {
      setMoveError(`${article.topic}: ${errorMessage(cause)}`);
    } finally {
      setMoving(false);
    }
  }

  function dropInto(target: ArticleStatus) {
    const article = items.find((item) => item.id === draggingId);
    if (article) {
      void moveArticle(article, target);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Доска материалов</h1>
          <p className="text-on-surface-variant">
            Все материалы команды по статусам. Переходы проверяются правилами, а не вниманием
            редактора.
          </p>
        </div>
        <button
          type="button"
          className={`${BUTTON_PRIMARY} ${FOCUS_RING}`}
          aria-expanded={creating}
          aria-controls="create-article"
          onClick={() => setCreating((value) => !value)}
        >
          {creating ? 'Закрыть форму' : 'Новый материал'}
        </button>
      </header>

      {confirmation ? (
        <div aria-live="polite" className="flex flex-col gap-2">
          <Notice>{confirmation.text}</Notice>
          {confirmation.warnings.length > 0 ? (
            <ul className="list-disc pl-6 text-sm text-on-surface-variant">
              {confirmation.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {creating ? (
        <section id="create-article" aria-labelledby="create-title" className={PANEL_CLASS}>
          <h2 id="create-title" className="font-display text-lg font-bold">
            Новый материал
          </h2>
          <div className="mt-4">
            {catalog.loaded && !catalog.failed ? (
              <CreateArticleForm
                styles={catalog.styles}
                formats={catalog.formats}
                products={catalog.products}
                onCreated={handleCreated}
                onCancel={() => setCreating(false)}
              />
            ) : (
              <Notice tone={catalog.failed ? 'error' : 'neutral'}>
                {catalog.failed
                  ? 'Не удалось загрузить стили и продукты.'
                  : 'Загружаем стили и продукты…'}
              </Notice>
            )}
          </div>
        </section>
      ) : null}

      <BoardFilters
        filters={filters}
        styles={catalog.styles}
        owners={owners}
        ownerId={ownerId}
        onlyBlocked={onlyBlocked}
        onChange={setFilters}
        onOwnerChange={setOwnerId}
        onOnlyBlockedChange={setOnlyBlocked}
      />

      {moveError ? <Notice tone="error">{moveError}</Notice> : null}
      {board.phase === 'loading' ? <Notice>Загружаем материалы…</Notice> : null}
      {board.phase === 'error' ? <Notice tone="error">{board.message}</Notice> : null}
      {board.phase === 'ready' && board.truncated ? (
        <Notice>Показаны первые 500 материалов. Уточните фильтры.</Notice>
      ) : null}
      {board.phase === 'ready' && visibleItems.length === 0 ? (
        <Notice>По выбранным фильтрам материалов нет.</Notice>
      ) : null}

      {board.phase === 'ready' ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {columns.map((column) => (
            <BoardColumn
              key={column.title}
              column={column}
              articles={visibleItems.filter((article) => column.statuses.includes(article.status))}
              user={user}
              moving={moving}
              isDropTarget={dropTarget === column.dropStatus}
              onDragOver={() => setDropTarget(column.dropStatus)}
              onDragLeave={() => setDropTarget(undefined)}
              onDrop={() => dropInto(column.dropStatus)}
              onMove={(article, target) => void moveArticle(article, target)}
              onDragStart={(article) => {
                setDraggingId(article.id);
                setMoveError(undefined);
              }}
              onDragEnd={() => {
                setDraggingId(undefined);
                setDropTarget(undefined);
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface BoardColumnProps {
  readonly column: ColumnDefinition;
  readonly articles: readonly ArticleItem[];
  readonly user: { readonly id: string; readonly role: UserRole } | undefined;
  readonly moving: boolean;
  readonly isDropTarget: boolean;
  readonly onDragOver: () => void;
  readonly onDragLeave: () => void;
  readonly onDrop: () => void;
  readonly onMove: (article: ArticleItem, target: ArticleStatus) => void;
  readonly onDragStart: (article: ArticleItem) => void;
  readonly onDragEnd: () => void;
}

function BoardColumn({
  column,
  articles,
  user,
  moving,
  isDropTarget,
  onDragOver,
  onDragLeave,
  onDrop,
  onMove,
  onDragStart,
  onDragEnd,
}: BoardColumnProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={`flex w-72 shrink-0 flex-col gap-3 rounded-2xl bg-surface-container p-4 ${
        isDropTarget ? 'ring-2 ring-primary' : ''
      }`}
      onDragOver={(event) => {
        event.preventDefault();
        onDragOver();
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          onDragLeave();
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
    >
      <h2
        id={headingId}
        className="flex items-center justify-between gap-2 font-display text-base font-bold"
      >
        <span>{column.title}</span>
        <span className="text-sm font-medium text-on-surface-variant">{articles.length}</span>
      </h2>
      {articles.length === 0 ? (
        <p className="text-sm text-on-surface-variant">Пусто</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {articles.map((article) => (
            <ArticleCard
              key={article.id}
              article={article}
              nextStep={user ? nextStepFor(article, user)?.action : undefined}
              moveOptions={MOVE_OPTIONS.filter(
                (option) => !column.statuses.includes(option.status),
              )}
              onMove={(target) => onMove(article, target)}
              draggable={!moving}
              onDragStart={() => onDragStart(article)}
              onDragEnd={onDragEnd}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function uniqueOwners(items: readonly ArticleItem[]): PersonRef[] {
  const owners = new Map<string, PersonRef>();
  for (const item of items) {
    owners.set(item.owner.id, item.owner);
  }
  return [...owners.values()].sort((left, right) =>
    (left.name ?? left.login).localeCompare(right.name ?? right.login, 'ru'),
  );
}
