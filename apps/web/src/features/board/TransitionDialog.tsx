import { type FormEvent, useState } from 'react';
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  INPUT_CLASS,
  LABEL_CLASS,
  PANEL_CLASS,
} from '../../shared/ui/classes';

export interface TransitionDialogProps {
  readonly required: 'url' | 'comment';
  readonly onSubmit: (value: string) => void;
  readonly onCancel: () => void;
}

const URL_PREFIX = 'https://dzen.ru/';
const COMMENT_MIN_LENGTH = 10;

// Диалог обязательных данных перехода: ссылка на публикацию или комментарий возврата.
export function TransitionDialog({ required, onSubmit, onCancel }: TransitionDialogProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const isUrl = required === 'url';

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = value.trim();
    if (isUrl && !/^https:\/\/dzen\.ru\/\S+$/.test(trimmed)) {
      setError(`Ссылка должна начинаться с ${URL_PREFIX}`);
      return;
    }
    if (!isUrl && trimmed.length < COMMENT_MIN_LENGTH) {
      setError(`Комментарий короче ${COMMENT_MIN_LENGTH} знаков`);
      return;
    }
    setError(undefined);
    onSubmit(trimmed);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/40 p-4 pt-24">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isUrl ? 'Публикация материала' : 'Возврат на доработку'}
        className={`${PANEL_CLASS} w-full max-w-lg`}
      >
        <h2 className="font-display text-lg font-bold">
          {isUrl ? 'Ссылка на публикацию' : 'Возврат на доработку'}
        </h2>
        <p className="mt-1 text-sm text-on-surface-variant">
          {isUrl
            ? 'Материал переходит в «Опубликовано». Укажите ссылку на статью в Дзене.'
            : 'Материал возвращается автору. Объясните, что нужно исправить.'}
        </p>

        <form className="mt-4 flex flex-col gap-4" onSubmit={submit}>
          <div className={LABEL_CLASS}>
            <label htmlFor="transition-value">
              {isUrl ? 'Ссылка на статью в Дзене' : 'Комментарий к возврату'}
            </label>
            {isUrl ? (
              <input
                id="transition-value"
                type="url"
                className={INPUT_CLASS}
                value={value}
                placeholder={URL_PREFIX}
                autoFocus
                onChange={(event) => setValue(event.target.value)}
              />
            ) : (
              <textarea
                id="transition-value"
                className={`${INPUT_CLASS} min-h-28`}
                value={value}
                placeholder="Что исправить перед повторным ревью"
                autoFocus
                onChange={(event) => setValue(event.target.value)}
              />
            )}
          </div>
          {error !== undefined ? (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className={BUTTON_PRIMARY}>
              Переместить
            </button>
            <button type="button" className={BUTTON_SECONDARY} onClick={onCancel}>
              Отмена
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
