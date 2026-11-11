import type { ArticleDetail, AutopilotEvent } from '@dzenwriter/shared';
import { useEffect, useRef, useState } from 'react';
import { fetchArticle } from '../../api/articles';
import { startAutopilot } from '../../api/autopilot';
import { errorMessage } from '../../api/client';
import { BUTTON_PRIMARY, BUTTON_SECONDARY, PANEL_CLASS } from '../../shared/ui/classes';
import { Notice } from '../../shared/ui/Notice';

interface AutopilotPanelProps {
  readonly article: ArticleDetail;
  readonly canRun: boolean;
  readonly onChanged: (article: ArticleDetail) => void;
}

interface ProgressLine {
  readonly key: number;
  readonly text: string;
}

// Автопилот запускается, только когда все привязанные факты одобрены:
// иначе модель начнёт писать по черновикам.
export function AutopilotPanel({ article, canRun, onChanged }: AutopilotPanelProps) {
  const [lines, setLines] = useState<readonly ProgressLine[]>([]);
  const [result, setResult] = useState<
    Extract<AutopilotEvent, { readonly type: 'result' }> | undefined
  >(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const counter = useRef(0);

  useEffect(() => () => abortRef.current?.abort(), []);

  const factsReady =
    article.facts.length > 0 && article.facts.every((fact) => fact.status === 'approved');
  if (!factsReady) {
    return null;
  }

  async function run() {
    setRunning(true);
    setError(undefined);
    setResult(undefined);
    setLines([]);
    counter.current = 0;
    const controller = new AbortController();
    abortRef.current = controller;
    let created = false;
    try {
      for await (const event of startAutopilot(article.id, { signal: controller.signal })) {
        append(event);
        if (event.type === 'result') {
          created = event.versionNumber !== null;
        }
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(errorMessage(cause));
      }
    } finally {
      setRunning(false);
      abortRef.current = undefined;
      if (created) {
        fetchArticle(article.id).then(onChanged, () => undefined);
      }
    }
  }

  function append(event: AutopilotEvent) {
    if (event.type === 'stage') {
      setLines((current) => [...current, { key: counter.current++, text: event.message }]);
      return;
    }
    if (event.type === 'result') {
      setResult(event);
      return;
    }
    setError(event.message);
  }

  return (
    <section aria-labelledby="autopilot-title" className={PANEL_CLASS}>
      <h2 id="autopilot-title" className="font-display text-lg font-bold">
        Автопилот
      </h2>
      <p className="mt-2 text-sm text-on-surface-variant">
        Соберёт бриф, сгенерирует текст и до трёх итераций исправит замечания проверок. Каждая
        итерация расходует суточный лимит LLM.
      </p>

      {canRun ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={BUTTON_PRIMARY}
            disabled={running}
            onClick={() => void run()}
          >
            {running ? 'Автопилот работает…' : 'Запустить Автопилот'}
          </button>
          {running ? (
            <button
              type="button"
              className={BUTTON_SECONDARY}
              onClick={() => abortRef.current?.abort()}
            >
              Остановить
            </button>
          ) : null}
        </div>
      ) : null}

      {lines.length > 0 ? (
        <ol
          className="mt-4 flex flex-col gap-1 text-sm"
          aria-label="Прогресс автопилота"
          aria-live="polite"
        >
          {lines.map((line) => (
            <li key={line.key}>{line.text}</li>
          ))}
        </ol>
      ) : null}

      {result !== undefined ? (
        <p className="mt-4 text-sm" aria-live="polite">
          Готово за {result.iterations} {result.iterations === 1 ? 'итерацию' : 'итерации'}:
          блокирующих {result.blocking}, предупреждений {result.warnings}.
          {result.versionNumber !== null
            ? ` Актуальная версия ${result.versionNumber}.`
            : ' Версия не создана.'}
        </p>
      ) : null}

      {error ? (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}
    </section>
  );
}
