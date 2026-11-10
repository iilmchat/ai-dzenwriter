import { useState } from 'react';
import { regenerateFragment } from '../../api/articles';
import { errorMessage } from '../../api/client';
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  FOCUS_RING,
  INPUT_CLASS,
  LABEL_CLASS,
  PANEL_CLASS,
} from '../../shared/ui/classes';

export interface FragmentRegenerateDialogProps {
  readonly articleId: string;
  readonly selectedText: string;
  readonly contextBefore: string;
  readonly contextAfter: string;
  readonly onApply: (text: string) => void;
  readonly onClose: () => void;
}

interface Preset {
  readonly id: string;
  readonly label: string;
  readonly instruction: string;
}

const PRESETS: readonly Preset[] = [
  {
    id: 'improve',
    label: 'Улучшить',
    instruction: 'Улучшить текст: сделать его яснее и грамотнее, сохранить смысл.',
  },
  {
    id: 'shorten',
    label: 'Сократить',
    instruction: 'Сократить фрагмент, убрав лишнее и сохранив ключевые мысли.',
  },
  {
    id: 'details',
    label: 'Добавить деталей',
    instruction: 'Добавить деталей и конкретики, не выдумывая фактов.',
  },
  {
    id: 'tone',
    label: 'Сменить тон (экспертный/дружелюбный)',
    instruction: 'Сменить тон на экспертный и дружелюбный, сохранить смысл и факты.',
  },
];

// Локальная правка фрагмента: пресет или своя инструкция, предпросмотр,
// применение только по кнопке. Версия статьи здесь не создаётся.
export function FragmentRegenerateDialog({
  articleId,
  selectedText,
  contextBefore,
  contextAfter,
  onApply,
  onClose,
}: FragmentRegenerateDialogProps) {
  const [instruction, setInstruction] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function generate() {
    if (instruction.trim().length === 0) {
      return;
    }
    setLoading(true);
    setError(undefined);
    setResult(null);
    try {
      const response = await regenerateFragment(articleId, {
        selectedText,
        contextBefore,
        contextAfter,
        instruction: instruction.trim(),
      });
      setResult(response.text);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/40 p-4 pt-16">
      <div
        className={`${PANEL_CLASS} w-full max-w-2xl`}
        role="dialog"
        aria-modal="true"
        aria-label="Перегенерация фрагмента"
      >
        <h2 className="font-display text-lg font-bold">Перегенерировать фрагмент</h2>
        <p className="mt-1 text-sm text-on-surface-variant">
          Модель получит выделенный текст и окружение. Текст в статье изменится только после
          «Применить».
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`${BUTTON_SECONDARY} px-4 py-2 text-sm ${FOCUS_RING}`}
              onClick={() => setInstruction(preset.instruction)}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className={`${LABEL_CLASS} mt-4`}>
          <label htmlFor="fragment-instruction">Свой вариант</label>
          <textarea
            id="fragment-instruction"
            className={`${INPUT_CLASS} min-h-[84px]`}
            value={instruction}
            maxLength={2000}
            placeholder="Например: сделай абзац короче и добавь пример"
            onChange={(event) => setInstruction(event.target.value)}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={BUTTON_PRIMARY}
            disabled={loading || instruction.trim().length === 0}
            onClick={() => void generate()}
          >
            {loading ? 'Генерируем…' : 'Сгенерировать'}
          </button>
        </div>

        {error !== undefined ? (
          <p role="alert" className="mt-4 text-sm text-error">
            {error}
          </p>
        ) : null}

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <section className="rounded-xl border border-outline-variant p-3" aria-label="Было">
            <h3 className="text-sm font-semibold">Было</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm">{selectedText}</p>
          </section>
          <section className="rounded-xl border border-outline-variant p-3" aria-label="Стало">
            <h3 className="text-sm font-semibold">Стало</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm">
              {result ?? (loading ? 'Генерируем…' : 'Пока не сгенерировано')}
            </p>
          </section>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={BUTTON_PRIMARY}
            disabled={result === null || loading}
            onClick={() => {
              if (result !== null) {
                onApply(result);
              }
            }}
          >
            Применить
          </button>
          <button type="button" className={BUTTON_SECONDARY} onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
