import {
  FACT_STATUS_LABELS,
  FACT_TYPE_LABELS,
  policyAllowsFactType,
  type ArticleDetail,
  type FactItem,
  type StyleCard,
} from '@dzenwriter/shared';
import { useEffect, useId, useState } from 'react';
import { attachFact, detachFact } from '../../api/articles';
import { errorMessage } from '../../api/client';
import { fetchFacts } from '../../api/facts';
import { capitalize, formatDate, truncate } from '../../lib/format';
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  INPUT_CLASS,
  LABEL_CLASS,
  PANEL_CLASS,
} from '../../shared/ui/classes';
import { Notice } from '../../shared/ui/Notice';

interface ArticleFactsPanelProps {
  readonly article: ArticleDetail;
  readonly style: StyleCard | undefined;
  readonly canEdit: boolean;
  readonly onChanged: (article: ArticleDetail) => void;
}

// Метки F1…Fn видит автор и модель: утверждения текста ссылаются на них.
export function ArticleFactsPanel({ article, style, canEdit, onChanged }: ArticleFactsPanelProps) {
  const [error, setError] = useState<string | undefined>(undefined);
  const [busyFactId, setBusyFactId] = useState<string | undefined>(undefined);

  async function detach(factId: string) {
    setBusyFactId(factId);
    setError(undefined);
    try {
      onChanged(await detachFact(article.id, factId));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusyFactId(undefined);
    }
  }

  return (
    <section aria-labelledby="facts-title" className={PANEL_CLASS}>
      <h2 id="facts-title" className="font-display text-lg font-bold">
        Факты материала
      </h2>
      <p className="mt-2 text-sm text-on-surface-variant">
        На ревью уходят только материалы, где все привязанные факты одобрены.
      </p>

      {article.facts.length === 0 ? (
        <p className="mt-4 text-sm text-on-surface-variant">Факты пока не привязаны.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {article.facts.map((fact) => (
            <li
              key={fact.factId}
              className="flex flex-col gap-1 rounded-xl border border-outline-variant p-3 text-sm"
            >
              <p className="font-medium">
                {fact.label} · {capitalize(FACT_TYPE_LABELS[fact.type])} ·{' '}
                {FACT_STATUS_LABELS[fact.status]}
              </p>
              <p className="whitespace-pre-line">
                {fact.text || 'Текст удалён после отзыва согласия.'}
              </p>
              {fact.sourceName || fact.sourceUrl ? (
                <p className="text-on-surface-variant">
                  Источник: {fact.sourceName ?? 'без названия'}
                  {fact.sourcePublishedAt ? `, ${formatDate(fact.sourcePublishedAt)}` : ''}
                  {fact.sourceUrl ? (
                    <>
                      {' · '}
                      <a
                        href={fact.sourceUrl}
                        rel="noopener noreferrer"
                        target="_blank"
                        className="underline"
                      >
                        ссылка
                      </a>
                    </>
                  ) : null}
                </p>
              ) : null}
              {canEdit ? (
                <div className="mt-1">
                  <button
                    type="button"
                    className={BUTTON_SECONDARY}
                    disabled={busyFactId === fact.factId}
                    onClick={() => void detach(fact.factId)}
                  >
                    Убрать из материала
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}

      {canEdit ? <AttachFact article={article} style={style} onAttached={onChanged} /> : null}
    </section>
  );
}

type LibraryState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly items: readonly FactItem[] }
  | { readonly phase: 'error'; readonly message: string };

// Подбираем только то, что сервер примет: подходящий тип по политике стиля, черновик или одобренный факт,
// продукт совпадает, факта ещё нет в материале. Сервер всё равно проверит при привязке.
function AttachFact({
  article,
  style,
  onAttached,
}: {
  readonly article: ArticleDetail;
  readonly style: StyleCard | undefined;
  readonly onAttached: (article: ArticleDetail) => void;
}) {
  const [library, setLibrary] = useState<LibraryState>({ phase: 'loading' });
  const [selected, setSelected] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetchFacts().then(
      (response) => {
        if (active) {
          setLibrary({ phase: 'ready', items: response.items });
        }
      },
      (cause: unknown) => {
        if (active) {
          setLibrary({ phase: 'error', message: errorMessage(cause) });
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const selectId = useId();
  const linked = new Set(article.facts.map((fact) => fact.factId));
  const candidates =
    library.phase === 'ready'
      ? library.items.filter((fact) => canAttach(fact, article, style, linked))
      : [];

  async function attach() {
    if (!selected) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const next = await attachFact(article.id, selected);
      setSelected('');
      onAttached(next);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 flex flex-col gap-3 border-t border-outline-variant pt-4">
      <h3 className="font-medium">Привязать факт из библиотеки</h3>
      {library.phase === 'loading' ? <p className="text-sm">Загружаем библиотеку…</p> : null}
      {library.phase === 'error' ? <Notice tone="error">{library.message}</Notice> : null}
      {library.phase === 'ready' && candidates.length === 0 ? (
        <p className="text-sm text-on-surface-variant">
          Подходящих фактов нет. Добавьте их в факт-базе: нужны черновики или одобренные факты типа,
          который допускает стиль.
        </p>
      ) : null}
      {candidates.length > 0 ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className={`${LABEL_CLASS} min-w-0 flex-1`}>
            <label htmlFor={selectId}>Факт</label>
            <select
              id={selectId}
              className={INPUT_CLASS}
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
            >
              <option value="">Выберите факт</option>
              {candidates.map((fact) => (
                <option key={fact.id} value={fact.id}>
                  {`${capitalize(FACT_TYPE_LABELS[fact.type])}, ${FACT_STATUS_LABELS[fact.status].toLowerCase()}: ${truncate(fact.text, 80)}`}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className={BUTTON_PRIMARY}
            disabled={!selected || busy}
            onClick={() => void attach()}
          >
            Привязать
          </button>
        </div>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}

function canAttach(
  fact: FactItem,
  article: ArticleDetail,
  style: StyleCard | undefined,
  linked: ReadonlySet<string>,
): boolean {
  if (linked.has(fact.id) || (fact.status !== 'draft' && fact.status !== 'approved')) {
    return false;
  }
  if (style && !policyAllowsFactType(style.factPolicy, fact.type)) {
    return false;
  }
  return (
    fact.productId === null || article.productId === null || fact.productId === article.productId
  );
}
