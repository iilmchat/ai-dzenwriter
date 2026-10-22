import {
  GENERATION_STAGE_LABELS,
  type ArticleDetail,
  type GenerationResult,
  type GenerationRunSummary,
  type GenerationStage,
  type GenerationStageEvent,
} from '@dzenwriter/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { confirmGeneration, fetchArticle } from '../../api/articles';
import {
  cancelGeneration,
  fetchGenerationRuns,
  startGeneration,
  type GenerationEvent,
} from '../../api/generation';
import { errorMessage } from '../../api/client';
import { formatDateTime } from '../../lib/format';
import { BUTTON_PRIMARY, BUTTON_SECONDARY, PANEL_CLASS } from '../../shared/ui/classes';
import { Notice } from '../../shared/ui/Notice';

interface GenerationPanelProps {
  readonly article: ArticleDetail;
  readonly canRun: boolean;
  readonly canConfirm: boolean;
  readonly onChanged: (article: ArticleDetail) => void;
}

const STAGE_ORDER: readonly GenerationStage[] = ['prompt', 'generate', 'parse', 'checks'];

const RUN_STATUS_LABELS: Record<string, string> = {
  running: 'Идёт',
  succeeded: 'Успешно',
  needs_input: 'Нужны ответы',
  failed: 'Ошибка',
  cancelled: 'Отменён',
};

// Панель запуска генерации: кнопка, стадии по ходу потока и история запусков материала.
export function GenerationPanel({ article, canRun, canConfirm, onChanged }: GenerationPanelProps) {
  const [runs, setRuns] = useState<GenerationRunSummary[]>([]);
  const [stage, setStage] = useState<GenerationStageEvent | undefined>(undefined);
  const [result, setResult] = useState<GenerationResult | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | undefined>(undefined);
  const abortRef = useRef<AbortController | undefined>(undefined);

  const refresh = useCallback(() => {
    fetchGenerationRuns(article.id).then(
      (response) => setRuns(response.items),
      () => undefined,
    );
  }, [article.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function run() {
    setRunning(true);
    setError(undefined);
    setStage(undefined);
    setResult(undefined);
    const controller = new AbortController();
    abortRef.current = controller;
    let created = false;
    try {
      for await (const event of startGeneration(article.id, {
        idempotencyKey: newIdempotencyKey(),
        signal: controller.signal,
      })) {
        applyEvent(event, setStage, setResult, setRunId);
        if (event.type === 'result' && event.result.status === 'succeeded') {
          created = true;
        }
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(errorMessage(cause));
      }
    } finally {
      setRunning(false);
      abortRef.current = undefined;
      refresh();
      if (created) {
        // Версия появилась в базе: карточка материала должна её показать.
        fetchArticle(article.id).then(onChanged, () => undefined);
      }
    }
  }

  async function cancel() {
    const current = runId;
    abortRef.current?.abort();
    if (current === undefined) {
      return;
    }
    try {
      await cancelGeneration(article.id, current);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      refresh();
    }
  }

  async function confirm() {
    setError(undefined);
    try {
      onChanged(await confirmGeneration(article.id));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  const availability = article.generation;

  return (
    <section aria-labelledby="generation-title" className={PANEL_CLASS}>
      <h2 id="generation-title" className="font-display text-lg font-bold">
        Генерация
      </h2>
      <p className="mt-2 text-sm text-on-surface-variant">
        Текст пишет модель по одобренным фактам. Без фактов материал не проходит на ревью.
      </p>

      {availability.outOfFocus ? (
        <p className="mt-3 text-sm text-on-surface-variant">
          {availability.confirmed
            ? 'Тема вне фокуса ИИ: запуск подтверждён ревьюером.'
            : 'Тема вне фокуса ИИ: запуск требует подтверждения ревьюера.'}
        </p>
      ) : null}

      {availability.outOfFocus && !availability.confirmed && canConfirm ? (
        <div className="mt-3">
          <button type="button" className={BUTTON_SECONDARY} onClick={() => void confirm()}>
            Подтвердить запуск
          </button>
        </div>
      ) : null}

      {canRun ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={BUTTON_PRIMARY}
            disabled={running || !availability.allowed}
            onClick={() => void run()}
          >
            {running ? 'Генерируем…' : 'Сгенерировать'}
          </button>
          {running ? (
            <button type="button" className={BUTTON_SECONDARY} onClick={() => void cancel()}>
              Отменить
            </button>
          ) : null}
        </div>
      ) : null}

      {canRun && !availability.allowed && availability.reason !== null ? (
        <p className="mt-3 text-sm text-on-surface-variant">{availability.reason}</p>
      ) : null}

      {stage !== undefined ? (
        <ol
          className="mt-4 flex flex-col gap-1 text-sm"
          aria-label="Стадии генерации"
          aria-live="polite"
        >
          {STAGE_ORDER.map((name) => (
            <li key={name} className="flex items-center gap-2">
              <span aria-hidden="true">{stageMark(stage, name)}</span>
              <span>{GENERATION_STAGE_LABELS[name]}</span>
              {stage.stage === name && stage.message !== undefined ? (
                <span className="text-on-surface-variant">{stage.message}</span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}

      {result !== undefined ? <RunResult result={result} /> : null}

      {error ? (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}

      <div className="mt-6 border-t border-outline-variant pt-4">
        <h3 className="font-medium">История запусков</h3>
        {runs.length === 0 ? (
          <p className="mt-2 text-sm text-on-surface-variant">Запусков пока не было.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {runs.map((item) => (
              <li key={item.id}>
                {RUN_STATUS_LABELS[item.status] ?? item.status}
                {item.versionNumber !== null ? `, версия ${item.versionNumber}` : ''}
                {', '}
                {formatDateTime(item.createdAt)}
                {item.latencyMs !== null ? `, ${item.latencyMs} мс` : ''}
                {item.errorCode !== null ? `, код ${item.errorCode}` : ''}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function RunResult({ result }: { readonly result: GenerationResult }) {
  if (result.status === 'needs_input') {
    return (
      <div className="mt-4">
        <Notice>Модели не хватило фактов. Ответьте на вопросы и запустите снова.</Notice>
        <ul className="mt-3 flex list-disc flex-col gap-1 pl-5 text-sm">
          {result.questions.map((question) => (
            <li key={question}>{question}</li>
          ))}
        </ul>
      </div>
    );
  }
  if (result.status === 'succeeded') {
    return <p className="mt-4 text-sm">Готово: создана версия {result.versionNumber ?? '—'}.</p>;
  }
  if (result.status === 'cancelled') {
    return <p className="mt-4 text-sm">Запуск отменён.</p>;
  }
  return (
    <p className="mt-4 text-sm text-on-surface-variant">
      Запуск не удался{result.errorCode !== null ? `: ${result.errorCode}` : ''}. Текст не
      изменился.
    </p>
  );
}

// Значок стадии: символ один и тот же для всех, статус читается текстом рядом.
// Стадии идут по порядку, поэтому пройденные помечаются галочкой.
function stageMark(current: GenerationStageEvent, name: GenerationStage): string {
  const currentIndex = STAGE_ORDER.indexOf(current.stage);
  const index = STAGE_ORDER.indexOf(name);
  if (index < currentIndex) {
    return '✓';
  }
  if (index > currentIndex) {
    return '•';
  }
  switch (current.status) {
    case 'running':
      return '…';
    case 'done':
      return '✓';
    case 'failed':
      return '✕';
    default:
      return '–';
  }
}

// Ключ идемпотентности: повторный клик не должен создавать второй запуск.
function newIdempotencyKey(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function applyEvent(
  event: GenerationEvent,
  setStage: (value: GenerationStageEvent) => void,
  setResult: (value: GenerationResult) => void,
  setRunId: (value: string) => void,
): void {
  if (event.type === 'stage') {
    setStage(event.stage);
    return;
  }
  setResult(event.result);
  setRunId(event.result.runId);
}
