import { type FormEvent, useState } from 'react';
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  INPUT_CLASS,
  LABEL_CLASS,
  PANEL_CLASS,
} from '../../shared/ui/classes';

export interface ReviewCommentDialogProps {
  readonly selectedText: string;
  readonly saving?: boolean;
  readonly onSubmit: (comment: string) => void;
  readonly onCancel: () => void;
}

// Комментарий к выделенному фрагменту: контекст виден, текст не теряется.
export function ReviewCommentDialog({
  selectedText,
  saving = false,
  onSubmit,
  onCancel,
}: ReviewCommentDialogProps) {
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = comment.trim();
    if (trimmed.length === 0) {
      setError('Напишите комментарий');
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
        aria-label="Комментарий к фрагменту"
        className={`${PANEL_CLASS} w-full max-w-lg`}
      >
        <h2 className="font-display text-lg font-bold">Комментарий к фрагменту</h2>
        <blockquote className="mt-3 rounded-lg border-l-4 border-primary bg-surface p-3 text-sm text-on-surface-variant">
          {selectedText}
        </blockquote>

        <form className="mt-4 flex flex-col gap-4" onSubmit={submit}>
          <div className={LABEL_CLASS}>
            <label htmlFor="review-comment">Комментарий</label>
            <textarea
              id="review-comment"
              className={`${INPUT_CLASS} min-h-28`}
              value={comment}
              maxLength={5000}
              autoFocus
              placeholder="Что исправить или уточнить в этом фрагменте"
              onChange={(event) => setComment(event.target.value)}
            />
          </div>
          {error !== undefined ? (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className={BUTTON_PRIMARY} disabled={saving}>
              {saving ? 'Сохраняем…' : 'Сохранить'}
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
