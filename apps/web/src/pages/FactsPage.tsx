import { FACT_TYPE_LABELS, type FactItem } from '@dzenwriter/shared';
import { useEffect, useState } from 'react';
import { errorMessage } from '../api/client';
import { fetchFacts } from '../api/facts';
import { useCatalog } from '../features/catalog/useCatalog';
import { FactCard } from '../features/facts/FactCard';
import { EMPTY_FACTS_FILTERS, FactFilters, type FactsFilters } from '../features/facts/FactFilters';
import { FactForm } from '../features/facts/FactForm';
import { capitalize } from '../lib/format';
import { BUTTON_PRIMARY, FOCUS_RING, PANEL_CLASS } from '../shared/ui/classes';
import { Notice } from '../shared/ui/Notice';

type FactsState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly items: readonly FactItem[]; readonly truncated: boolean }
  | { readonly phase: 'error'; readonly message: string };

interface Feedback {
  readonly tone: 'neutral' | 'error';
  readonly text: string;
}

const SEARCH_DELAY_MS = 250;

// Библиотека фактов: создание, фильтры и действия над фактами по правам текущего пользователя.
export function FactsPage() {
  const catalog = useCatalog();
  const [filters, setFilters] = useState<FactsFilters>(EMPTY_FACTS_FILTERS);
  const [reloadKey, setReloadKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | undefined>(undefined);
  const [facts, setFacts] = useState<FactsState>({ phase: 'loading' });
  const filterKey = JSON.stringify(filters);

  useEffect(() => {
    let active = true;
    // Короткая пауза: при наборе в поиске не отправляем запрос на каждую букву.
    const timer = window.setTimeout(() => {
      const current = JSON.parse(filterKey) as FactsFilters;
      fetchFacts({
        type: current.type || undefined,
        status: current.status || undefined,
        q: current.q.trim() || undefined,
      }).then(
        (response) => {
          if (active) {
            setFacts({ phase: 'ready', items: response.items, truncated: response.truncated });
          }
        },
        (cause: unknown) => {
          if (active) {
            setFacts({ phase: 'error', message: errorMessage(cause) });
          }
        },
      );
    }, SEARCH_DELAY_MS);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [filterKey, reloadKey]);

  function reload(message: string) {
    setFeedback({ tone: 'neutral', text: message });
    setReloadKey((value) => value + 1);
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Факт-база</h1>
          <p className="mt-2 max-w-3xl text-on-surface-variant">
            Источники, факты о компании и продуктах, заметки опыта с согласием. В материал попадают
            только факты из этой библиотеки, и каждому присваивается метка F1…Fn.
          </p>
        </div>
        <button
          type="button"
          className={`${BUTTON_PRIMARY} ${FOCUS_RING}`}
          aria-expanded={creating}
          aria-controls="create-fact"
          onClick={() => setCreating((value) => !value)}
        >
          {creating ? 'Закрыть форму' : 'Новый факт'}
        </button>
      </header>

      {feedback ? <Notice tone={feedback.tone}>{feedback.text}</Notice> : null}

      {creating ? (
        <section id="create-fact" aria-labelledby="create-fact-title" className={PANEL_CLASS}>
          <h2 id="create-fact-title" className="font-display text-lg font-bold">
            Новый факт
          </h2>
          <div className="mt-4">
            <FactForm
              mode="create"
              products={catalog.products}
              onSaved={(fact) => {
                setCreating(false);
                reload(
                  `Факт добавлен: ${capitalize(FACT_TYPE_LABELS[fact.type])}. Он ждёт одобрения ревьюера`,
                );
              }}
              onCancel={() => setCreating(false)}
            />
          </div>
        </section>
      ) : null}

      <FactFilters filters={filters} onChange={setFilters} />

      {facts.phase === 'loading' ? <Notice>Загружаем факты…</Notice> : null}
      {facts.phase === 'error' ? <Notice tone="error">{facts.message}</Notice> : null}
      {facts.phase === 'ready' && facts.truncated ? (
        <Notice>Показаны первые 500 фактов. Уточните фильтры.</Notice>
      ) : null}
      {facts.phase === 'ready' && facts.items.length === 0 ? (
        <Notice>Ничего не найдено. Измените фильтры или добавьте факт.</Notice>
      ) : null}

      {facts.phase === 'ready' ? (
        <ul className="flex flex-col gap-4">
          {facts.items.map((fact) => (
            <li key={fact.id}>
              <FactCard
                fact={fact}
                products={catalog.products}
                onChanged={reload}
                onError={(message) => setFeedback({ tone: 'error', text: message })}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
