import { useMemo, useEffect, useState } from 'react';
import type { ArticleItem, UserRole } from '@dzenwriter/shared';
import { Link } from 'react-router';
import { fetchArticles, type BoardFilters } from '../api/articles';
import { errorMessage } from '../api/client';
import { ArticleCard } from '../features/board/ArticleCard';
import { nextStepFor } from '../features/board/nextStep';
import { useSession } from '../session/SessionContext';
import { FOCUS_RING } from '../shared/ui/classes';
import { Notice } from '../shared/ui/Notice';

const ALL_ARTICLES: BoardFilters = {
  styleId: '',
  mine: false,
  plannedFrom: '',
  plannedTo: '',
  includeArchived: false,
};

type TasksState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly items: readonly ArticleItem[]; readonly truncated: boolean }
  | { readonly phase: 'error'; readonly message: string };

interface Task {
  readonly article: ArticleItem;
  readonly action: string;
}

interface TaskGroup {
  readonly title: string;
  readonly order: number;
  readonly tasks: readonly Task[];
}

// «Мои задачи»: материалы, где пользователь автор или ревьюер, с действием на следующий шаг.
export function MyTasksPage() {
  const { state: session } = useSession();
  const [state, setState] = useState<TasksState>({ phase: 'loading' });
  const user = session.phase === 'authenticated' ? session.user : undefined;

  useEffect(() => {
    let active = true;
    fetchArticles(ALL_ARTICLES).then(
      (response) => {
        if (active) {
          setState({ phase: 'ready', items: response.items, truncated: response.truncated });
        }
      },
      (cause: unknown) => {
        if (active) {
          setState({ phase: 'error', message: errorMessage(cause) });
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const groups = useMemo(
    () => (state.phase === 'ready' && user ? buildTaskGroups(state.items, user) : []),
    [state, user],
  );
  const total = groups.reduce((sum, group) => sum + group.tasks.length, 0);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-bold">Мои задачи</h1>
        <p className="text-on-surface-variant">
          Материалы, где вы автор или ревьюер. Сгруппированы по следующему действию, без ручного
          поиска по общей доске.
        </p>
        {state.phase === 'ready' ? <p className="text-sm">Всего задач: {total}</p> : null}
      </header>

      {state.phase === 'loading' ? <Notice>Собираем ваши задачи…</Notice> : null}
      {state.phase === 'error' ? <Notice tone="error">{state.message}</Notice> : null}
      {state.phase === 'ready' && state.truncated ? (
        <Notice>Показаны первые 500 материалов. Часть задач могла не попасть в список.</Notice>
      ) : null}

      {state.phase === 'ready' && groups.length === 0 ? (
        <section className="rounded-2xl border border-outline-variant bg-surface-container p-6">
          <p className="text-sm text-on-surface-variant">
            Задач нет. На доске можно взять материал в работу.
          </p>
          <Link
            to="/"
            className={`mt-4 inline-block text-sm font-medium hover:underline ${FOCUS_RING}`}
          >
            Перейти к доске
          </Link>
        </section>
      ) : null}

      {groups.map((group) => (
        <TaskSection key={group.title} group={group} />
      ))}
    </div>
  );
}

function TaskSection({ group }: { readonly group: TaskGroup }) {
  const headingId = `tasks-${group.order}`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="flex items-center gap-2 font-display text-xl font-bold">
        {group.title}
        <span className="text-sm font-medium text-on-surface-variant">{group.tasks.length}</span>
      </h2>
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {group.tasks.map((task) => (
          <ArticleCard key={task.article.id} article={task.article} nextStep={task.action} />
        ))}
      </ul>
    </section>
  );
}

function buildTaskGroups(
  articles: readonly ArticleItem[],
  user: { readonly id: string; readonly role: UserRole },
): TaskGroup[] {
  const groups = new Map<string, { order: number; tasks: Task[] }>();

  for (const article of articles) {
    const task = nextStepFor(article, user);
    if (!task) {
      continue;
    }
    const existing = groups.get(task.group) ?? { order: task.order, tasks: [] };
    existing.tasks.push({ article, action: task.action });
    groups.set(task.group, existing);
  }

  return [...groups.entries()]
    .map(([title, value]) => ({
      title,
      order: value.order,
      tasks: [...value.tasks].sort((left, right) =>
        right.article.updatedAt.localeCompare(left.article.updatedAt),
      ),
    }))
    .sort((left, right) => left.order - right.order);
}
