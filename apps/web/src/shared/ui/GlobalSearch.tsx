import type { SearchResultItem, SearchResultType } from '@dzenwriter/shared';
import { type KeyboardEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { fetchSearch } from '../../api/search';
import { INPUT_CLASS } from './classes';

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

const GROUPS: readonly { readonly type: SearchResultType; readonly label: string }[] = [
  { type: 'article', label: 'Статьи' },
  { type: 'fact', label: 'Факты' },
  { type: 'product', label: 'Продукты' },
];

// Поиск в шапке: результаты сгруппированы, работают мышь и клавиатура.
export function GlobalSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<readonly SearchResultItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setItems([]);
      setOpen(false);
      setLoading(false);
      setActiveIndex(0);
      return;
    }

    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      fetchSearch(trimmed).then(
        (response) => {
          if (!active) {
            return;
          }
          setItems(response.items);
          setActiveIndex(0);
          setOpen(true);
          setLoading(false);
        },
        () => {
          if (active) {
            setItems([]);
            setOpen(true);
            setLoading(false);
          }
        },
      );
    }, DEBOUNCE_MS);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const grouped = GROUPS.map((group) => ({
    ...group,
    items: items.filter((item) => item.type === group.type),
  })).filter((group) => group.items.length > 0);
  const flat = grouped.flatMap((group) => group.items);

  function choose(item: SearchResultItem) {
    setQuery('');
    setItems([]);
    setOpen(false);
    setActiveIndex(0);
    navigate(item.url);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!open) {
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((value) => (flat.length === 0 ? 0 : Math.min(value + 1, flat.length - 1)));
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((value) => Math.max(value - 1, 0));
    }
    if (event.key === 'Enter') {
      const item = flat[activeIndex];
      if (item !== undefined) {
        event.preventDefault();
        choose(item);
      }
    }
  }

  const showEmpty =
    open && !loading && query.trim().length >= MIN_QUERY_LENGTH && flat.length === 0;

  return (
    <div
      className="relative w-64"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width={18}
        height={18}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </svg>
      <input
        type="search"
        role="combobox"
        aria-label="Глобальный поиск"
        aria-expanded={open}
        aria-controls="global-search-results"
        aria-autocomplete="list"
        aria-activedescendant={
          flat[activeIndex] === undefined
            ? undefined
            : `global-search-${flat[activeIndex].type}-${flat[activeIndex].id}`
        }
        className={`${INPUT_CLASS} pl-9 text-sm`}
        placeholder="Поиск по материалам"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
        }}
        onFocus={() => {
          if (items.length > 0 && query.trim().length >= MIN_QUERY_LENGTH) {
            setOpen(true);
          }
        }}
        onKeyDown={onKeyDown}
      />

      {open ? (
        <div
          id="global-search-results"
          role="listbox"
          aria-label="Результаты поиска"
          className="absolute right-0 z-50 mt-2 max-h-96 w-80 overflow-auto rounded-2xl border border-outline-variant bg-surface p-2 shadow-lg"
        >
          {loading ? <p className="px-3 py-2 text-sm text-on-surface-variant">Ищем…</p> : null}
          {showEmpty ? (
            <p className="px-3 py-2 text-sm text-on-surface-variant">Ничего не найдено</p>
          ) : null}
          {grouped.map((group) => (
            <section key={group.type} aria-labelledby={`search-group-${group.type}`}>
              <h3
                id={`search-group-${group.type}`}
                className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-on-surface-variant"
              >
                {group.label}
              </h3>
              <ul className="flex flex-col">
                {group.items.map((item) => {
                  const index = flat.indexOf(item);
                  const active = index === activeIndex;
                  return (
                    <li key={`${item.type}-${item.id}`}>
                      <button
                        id={`global-search-${item.type}-${item.id}`}
                        type="button"
                        role="option"
                        aria-selected={active}
                        className={`w-full rounded-lg px-3 py-2 text-left ${
                          active ? 'bg-secondary-container text-on-secondary-container' : ''
                        }`}
                        onClick={() => choose(item)}
                      >
                        <span className="block truncate text-sm font-medium">{item.title}</span>
                        <span className="block truncate text-xs text-on-surface-variant">
                          {item.subtitle}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}
