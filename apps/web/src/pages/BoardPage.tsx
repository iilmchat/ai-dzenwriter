import {
  ARTICLE_STATUS_LABELS,
  type ArticleItem,
  type ArticleStatus,
  type CreateArticleResponse,
} from '@dzenwriter/shared';
import { useEffect, useId, useState } from 'react';
import { fetchArticles, type BoardFilters as Filters } from '../api/articles';
import { errorMessage } from '../api/client';
import { ArticleCard } from '../features/board/ArticleCard';
import { BoardFilters } from '../features/board/BoardFilters';
import { CreateArticleForm } from '../features/board/CreateArticleForm';
import { useCatalog } from '../features/catalog/useCatalog';
import { BUTTON_PRIMARY, FOCUS_RING, PANEL_CLASS } from '../shared/ui/classes';
import { Notice } from '../shared/ui/Notice';

const EMPTY_FILTERS: Filters = {
  styleId: '',
  mine: false,
  plannedFrom: '',
  plannedTo: '',
  includeArchived: false,
};

// Колонки доски из раздела 3 backlog. «Запланировано» входит в «Утверждено».
const COLUMNS: readonly { readonly title: string; readonly statuses: readonly ArticleStatus[] }[] =
  [
    { title: 'Идея', statuses: ['idea'] },
    { title: 'Факты', statuses: ['researching'] },
    { title: 'Черновик', statuses: ['drafting'] },
    { title: 'Ревью', statuses: ['in_review'] },
    { title: 'Утверждено', statuses: ['approved', 'scheduled'] },
    { title: 'Опубликовано', statuses: ['published'] },
  ];

const ARCHIVE_COLUMN = { title: ARTICLE_STATUS_LABELS.archived, statuses: ['archived'] as const };

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
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [reloadKey, setReloadKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | undefined>(undefined);
  const [board, setBoard] = useState<BoardState>({ phase: 'loading' });
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
  const columns = filters.includeArchived ? [...COLUMNS, ARCHIVE_COLUMN] : COLUMNS;

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

      <BoardFilters filters={filters} styles={catalog.styles} onChange={setFilters} />

      {board.phase === 'loading' ? <Notice>Загружаем материалы…</Notice> : null}
      {board.phase === 'error' ? <Notice tone="error">{board.message}</Notice> : null}
      {board.phase === 'ready' && board.truncated ? (
        <Notice>Показаны первые 500 материалов. Уточните фильтры.</Notice>
      ) : null}

      {board.phase === 'ready' ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {columns.map((column) => (
            <BoardColumn
              key={column.title}
              title={column.title}
              articles={items.filter((article) => column.statuses.includes(article.status))}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function BoardColumn({
  title,
  articles,
}: {
  readonly title: string;
  readonly articles: readonly ArticleItem[];
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex w-72 shrink-0 flex-col gap-3 rounded-2xl bg-surface-container p-4"
    >
      <h2
        id={headingId}
        className="flex items-center justify-between gap-2 font-display text-base font-bold"
      >
        <span>{title}</span>
        <span className="text-sm font-medium text-on-surface-variant">{articles.length}</span>
      </h2>
      {articles.length === 0 ? (
        <p className="text-sm text-on-surface-variant">Пусто</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {articles.map((article) => (
            <ArticleCard key={article.id} article={article} />
          ))}
        </ul>
      )}
    </section>
  );
}
