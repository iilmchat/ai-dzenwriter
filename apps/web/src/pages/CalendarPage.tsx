import {
  ARTICLE_STATUS_LABELS,
  type CalendarItem,
  type CalendarResponse,
} from '@dzenwriter/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { fetchCalendar } from '../api/calendar';
import { errorMessage } from '../api/client';
import { BUTTON_SECONDARY, FOCUS_RING, PANEL_CLASS } from '../shared/ui/classes';
import { Notice } from '../shared/ui/Notice';
import { Skeleton } from '../shared/ui/Skeleton';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const EMPTY: CalendarResponse = { items: [], authorLoad: [] };

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function currentMonthIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

function splitMonth(month: string): { readonly year: number; readonly monthIndex: number } {
  const [year, monthNumber] = month.split('-');
  return {
    year: Number(year),
    monthIndex: Number(monthNumber) - 1,
  };
}

function shiftMonth(month: string, delta: number): string {
  const { year, monthIndex } = splitMonth(month);
  const shifted = new Date(Date.UTC(year, monthIndex + delta, 1));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}`;
}

function monthTitle(month: string): string {
  const { year, monthIndex } = splitMonth(month);
  const formatted = new Intl.DateTimeFormat('ru-RU', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, monthIndex, 1)));
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

interface CalendarCell {
  readonly key: string;
  readonly day: number | null;
}

// Сетка с понедельника: пустые клетки до первого дня и до 5–6 полных строк.
function buildCells(month: string): CalendarCell[] {
  const { year, monthIndex } = splitMonth(month);
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const leading = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const cells: CalendarCell[] = [];
  for (let index = 0; index < leading; index += 1) {
    cells.push({ key: `leading-${index}`, day: null });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ key: `day-${day}`, day });
  }
  while (cells.length < 35 || cells.length % 7 !== 0) {
    cells.push({ key: `trailing-${cells.length}`, day: null });
  }
  return cells;
}

function itemsByDay(items: readonly CalendarItem[]): Map<string, CalendarItem[]> {
  const map = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const key = item.plannedAt.slice(0, 10);
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return map;
}

export function CalendarPage({ initialMonth }: { readonly initialMonth?: string } = {}) {
  const [currentMonth, setCurrentMonth] = useState(() => initialMonth ?? currentMonthIso());
  const [data, setData] = useState<CalendarResponse>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    fetchCalendar(currentMonth).then(
      (response) => {
        if (active) {
          setData(response);
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
  }, [currentMonth]);

  const cells = useMemo(() => buildCells(currentMonth), [currentMonth]);
  const byDay = useMemo(() => itemsByDay(data.items), [data.items]);
  const maxLoad = Math.max(...data.authorLoad.map((item) => item.count), 1);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Календарь</h1>
          <p className="text-on-surface-variant">
            Плановые даты материалов и загрузка авторов по месяцам.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className={`${BUTTON_SECONDARY} px-4 py-2`}
            aria-label="Предыдущий месяц"
            onClick={() => setCurrentMonth((month) => shiftMonth(month, -1))}
          >
            ←
          </button>
          <h2 aria-live="polite" className="min-w-48 text-center font-display text-xl font-bold">
            {monthTitle(currentMonth)}
          </h2>
          <button
            type="button"
            className={`${BUTTON_SECONDARY} px-4 py-2`}
            aria-label="Следующий месяц"
            onClick={() => setCurrentMonth((month) => shiftMonth(month, 1))}
          >
            →
          </button>
        </div>
      </header>

      {error !== undefined ? <Notice tone="error">{error}</Notice> : null}
      {loading ? (
        <section
          aria-busy="true"
          aria-label="Загрузка..."
          className={`${PANEL_CLASS} grid grid-cols-7 gap-1`}
        >
          {Array.from({ length: 42 }, (_, index) => (
            <div
              key={index}
              className="min-h-24 rounded-lg border border-outline-variant bg-surface p-1.5"
            >
              <Skeleton width="1.5rem" height="0.8rem" />
              <Skeleton height="2rem" className="mt-2" />
            </div>
          ))}
        </section>
      ) : null}

      {!loading ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <section aria-label="Календарь месяца" className={PANEL_CLASS}>
            <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
              {WEEKDAYS.map((day) => (
                <div key={day} className="px-1 py-2">
                  {day}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((cell) => {
                if (cell.day === null) {
                  return (
                    <div
                      key={cell.key}
                      aria-hidden="true"
                      className="min-h-28 rounded-lg bg-surface-container-lowest/40"
                    />
                  );
                }
                const dateKey = `${currentMonth}-${pad(cell.day)}`;
                const dayItems = byDay.get(dateKey) ?? [];
                return (
                  <div
                    key={cell.key}
                    aria-label={`${cell.day} ${monthTitle(currentMonth)}`}
                    className="flex min-h-28 flex-col gap-1 rounded-lg border border-outline-variant bg-surface p-1.5"
                  >
                    <span className="text-xs font-semibold text-on-surface-variant">
                      {cell.day}
                    </span>
                    {dayItems.slice(0, 2).map((item) => (
                      <Link
                        key={item.id}
                        to={`/articles/${item.id}`}
                        className={`rounded-md bg-secondary-container px-2 py-1 text-xs text-on-secondary-container hover:underline ${FOCUS_RING}`}
                      >
                        <span className="block truncate font-medium">{item.topic}</span>
                        <span className="block truncate">
                          {ARTICLE_STATUS_LABELS[item.status]} · {item.ownerName}
                        </span>
                      </Link>
                    ))}
                    {dayItems.length > 2 ? (
                      <span className="px-1 text-xs text-on-surface-variant">
                        +{dayItems.length - 2} ещё
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="author-load-title" className={PANEL_CLASS}>
            <h2 id="author-load-title" className="font-display text-lg font-bold">
              Загрузка авторов
            </h2>
            {data.authorLoad.length === 0 ? (
              <p className="mt-3 text-sm text-on-surface-variant">
                В этом месяце плановых статей нет.
              </p>
            ) : (
              <ul className="mt-4 flex flex-col gap-4">
                {data.authorLoad.map((author) => (
                  <li key={author.ownerId}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="font-medium">{author.ownerName}</span>
                      <span className="text-on-surface-variant">{author.count}</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.round((author.count / maxLoad) * 100)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
