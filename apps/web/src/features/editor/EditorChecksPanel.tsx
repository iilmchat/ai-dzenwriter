import { CHECK_LABELS, type AllCheckId, type VersionCheck } from '@dzenwriter/shared';
import { useState } from 'react';
import { errorMessage } from '../../api/client';
import { BUTTON_SECONDARY, INPUT_CLASS, PANEL_CLASS } from '../../shared/ui/classes';

export interface EditorChecksPanelProps {
  readonly checks: readonly VersionCheck[];
  // Клик по проверке переводит курсор в исходник и подсвечивает фрагмент.
  readonly onFocus: (check: VersionCheck) => void;
  // Подтверждение блокирующей проверки прямо в редакторе. Передаём саму
  // проверку: редактор сам найдёт её индекс в сохранённой версии.
  readonly onConfirm?: (check: VersionCheck, comment: string) => Promise<void>;
}

const GROUPS: readonly { readonly severity: VersionCheck['severity']; readonly title: string }[] = [
  { severity: 'block', title: 'Блокирует' },
  { severity: 'warn', title: 'Предупреждения' },
  { severity: 'info', title: 'Информация' },
];

// Панель проверок редактора: проверки сгруппированы по уровню, клик ведёт в текст.
export function EditorChecksPanel({ checks, onFocus, onConfirm }: EditorChecksPanelProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const blocking = checks.filter(
    (check) => check.severity === 'block' && check.decision !== 'confirmed',
  ).length;

  function openConfirm(index: number) {
    setOpenIndex(index);
    setComment('');
    setError(undefined);
  }

  async function submit(check: VersionCheck) {
    if (onConfirm === undefined) {
      return;
    }
    const trimmed = comment.trim();
    if (trimmed.length < 10) {
      setError('Комментарий короче 10 знаков');
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await onConfirm(check, trimmed);
      setOpenIndex(null);
      setComment('');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside className={PANEL_CLASS} aria-label="Проверки">
      <h2 className="font-display text-lg font-bold">Проверки</h2>
      {checks.length === 0 ? (
        <p className="mt-3 text-sm text-on-surface-variant">
          Нарушений не найдено. Проверки считаются при сохранении версии.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm font-medium">
            {blocking === 0
              ? 'Блокирующих проверок нет'
              : `Блокирующих проверок: ${blocking}. На ревью не отправить`}
          </p>
          {GROUPS.map((group) => {
            const items = checks.filter((check) => check.severity === group.severity);
            if (items.length === 0) {
              return null;
            }
            return (
              <div key={group.severity} className="mt-4">
                <p className="text-xs font-semibold text-on-surface-variant">{group.title}</p>
                <ul className="mt-2 flex flex-col gap-2">
                  {items.map((check, index) => {
                    const checkIndex = checks.indexOf(check);
                    const canConfirm =
                      onConfirm !== undefined &&
                      check.severity === 'block' &&
                      check.decision !== 'confirmed';
                    return (
                      <li key={`${check.id}-${check.start ?? 'нет позиции'}-${index}`}>
                        <button
                          type="button"
                          className={`w-full rounded-xl p-3 text-left text-sm ${
                            check.severity === 'block'
                              ? 'bg-error-container text-on-error-container'
                              : check.severity === 'warn'
                                ? 'bg-surface-container-high text-on-surface'
                                : 'bg-surface-container text-on-surface-variant'
                          }`}
                          onClick={() => onFocus(check)}
                        >
                          <span className="block font-medium">
                            {labelOf(check)}
                            {check.decision === 'confirmed' ? ' · подтверждено' : ''}
                          </span>
                          <span className="block">{check.message}</span>
                        </button>

                        {canConfirm && openIndex !== checkIndex ? (
                          <button
                            type="button"
                            className={`${BUTTON_SECONDARY} mt-2 px-3 py-1.5 text-xs`}
                            onClick={() => openConfirm(checkIndex)}
                          >
                            Подтвердить
                          </button>
                        ) : null}

                        {canConfirm && openIndex === checkIndex ? (
                          <div className="mt-2 flex flex-col gap-2">
                            <label
                              htmlFor={`check-comment-${checkIndex}`}
                              className="text-xs font-medium"
                            >
                              Почему проверку можно снять
                            </label>
                            <textarea
                              id={`check-comment-${checkIndex}`}
                              className={INPUT_CLASS}
                              rows={3}
                              value={comment}
                              maxLength={2000}
                              onChange={(event) => setComment(event.target.value)}
                            />
                            {error !== undefined ? (
                              <p role="alert" className="text-xs text-error">
                                {error}
                              </p>
                            ) : null}
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                className={`${BUTTON_SECONDARY} px-3 py-1.5 text-xs`}
                                disabled={saving || comment.trim().length < 10}
                                onClick={() => void submit(check)}
                              >
                                {saving ? 'Отправляем…' : 'Отправить'}
                              </button>
                              <button
                                type="button"
                                className="px-3 py-1.5 text-xs text-on-surface-variant"
                                onClick={() => setOpenIndex(null)}
                              >
                                Отмена
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </>
      )}
    </aside>
  );
}

// У проверки есть идентификатор из списка движка, но в базе может оказаться
// проверка из будущей версии правил: тогда показываем её идентификатор.
function labelOf(check: VersionCheck): string {
  return CHECK_LABELS[check.id as AllCheckId] ?? check.id;
}
