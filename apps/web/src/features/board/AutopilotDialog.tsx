import { autopilotExtractInputSchema, type AutopilotExtractResponse } from '@dzenwriter/shared';
import { type FormEvent, useState } from 'react';
import { extractFacts } from '../../api/autopilot';
import { errorMessage } from '../../api/client';
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  INPUT_CLASS,
  LABEL_CLASS,
  PANEL_CLASS,
} from '../../shared/ui/classes';
import { Notice } from '../../shared/ui/Notice';

interface AutopilotDialogProps {
  readonly onCreated: (response: AutopilotExtractResponse) => void;
  readonly onCancel: () => void;
}

// Модалка автопилота: автор вставляет сырое задание, модель извлекает факты,
// материал создаётся как «идея» — факты нужно одобрить перед запуском цикла.
export function AutopilotDialog({ onCreated, onCancel }: AutopilotDialogProps) {
  const [topic, setTopic] = useState('');
  const [rawTask, setRawTask] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = autopilotExtractInputSchema.safeParse({ topic, rawTask });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === 'string' && next[key] === undefined) {
          next[key] = issue.message;
        }
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setServerError(undefined);
    setBusy(true);
    try {
      onCreated(await extractFacts(parsed.data));
    } catch (cause) {
      setServerError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="autopilot-dialog-title"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
    >
      <section className={`${PANEL_CLASS} mt-12 w-full max-w-2xl`}>
        <h2 id="autopilot-dialog-title" className="font-display text-lg font-bold">
          Автопилот (Из текста)
        </h2>
        <p className="mt-2 text-sm text-on-surface-variant">
          Вставьте задание или исходный текст: автопилот извлечёт факты и создаст материал. Перед
          запуском цикла факты нужно одобрить.
        </p>

        <form
          onSubmit={(event) => void handleSubmit(event)}
          noValidate
          className="mt-4 flex flex-col gap-4"
        >
          <label className={LABEL_CLASS}>
            Тема материала
            <input
              className={INPUT_CLASS}
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              aria-invalid={errors.topic !== undefined}
              aria-describedby={errors.topic ? 'autopilot-topic-error' : undefined}
            />
            {errors.topic ? (
              <span id="autopilot-topic-error" className="text-sm text-error">
                {errors.topic}
              </span>
            ) : null}
          </label>

          <label className={LABEL_CLASS}>
            Задание или исходный текст
            <textarea
              className={`${INPUT_CLASS} min-h-48`}
              value={rawTask}
              onChange={(event) => setRawTask(event.target.value)}
              aria-invalid={errors.rawTask !== undefined}
              aria-describedby={errors.rawTask ? 'autopilot-raw-task-error' : undefined}
            />
            {errors.rawTask ? (
              <span id="autopilot-raw-task-error" className="text-sm text-error">
                {errors.rawTask}
              </span>
            ) : null}
          </label>

          {serverError ? <Notice tone="error">{serverError}</Notice> : null}

          <div className="flex flex-wrap justify-end gap-3">
            <button type="button" className={BUTTON_SECONDARY} onClick={onCancel}>
              Отмена
            </button>
            <button type="submit" className={BUTTON_PRIMARY} disabled={busy}>
              {busy ? 'Извлекаем факты…' : 'Извлечь факты'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
