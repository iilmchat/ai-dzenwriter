import {
  CHECK_LABELS,
  CHECK_SEVERITY_LABELS,
  type AllCheckId,
  type ArticleDetail,
  type VersionCheck,
} from '@dzenwriter/shared';
import { useState } from 'react';
import { confirmCheck } from '../../api/articles';
import { errorMessage } from '../../api/client';
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  INPUT_CLASS,
  LABEL_CLASS,
  PANEL_CLASS,
} from '../../shared/ui/classes';
import { Notice } from '../../shared/ui/Notice';

interface ChecksPanelProps {
  readonly article: ArticleDetail;
  readonly canConfirm: boolean;
  readonly onChanged: (article: ArticleDetail) => void;
}

// Панель проверок текущей версии. Блокирующие проверки не дают материалу
// уйти на ревью, пока автор не подтвердит их с комментарием.
export function ChecksPanel({ article, canConfirm, onChanged }: ChecksPanelProps) {
  const [error, setError] = useState<string | undefined>(undefined);
  const [busyIndex, setBusyIndex] = useState<number | undefined>(undefined);
  const [comment, setComment] = useState('');
  const [openIndex, setOpenIndex] = useState<number | undefined>(undefined);

  const checks = article.checks;
  const versionNumber = article.currentVersionNumber;
  const blocking = checks.filter(
    (item) => item.severity === 'block' && item.decision !== 'confirmed',
  ).length;

  async function confirm(index: number) {
    if (versionNumber === null) {
      setError('Сначала создайте версию: подтверждать нечего.');
      return;
    }
    if (comment.trim().length === 0) {
      setError('Напишите, почему проверку можно снять.');
      return;
    }
    setBusyIndex(index);
    setError(undefined);
    try {
      onChanged(await confirmCheck(article.id, versionNumber, index, comment.trim()));
      setComment('');
      setOpenIndex(undefined);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusyIndex(undefined);
    }
  }

  return (
    <section aria-labelledby="checks-title" className={PANEL_CLASS}>
      <h2 id="checks-title" className="font-display text-lg font-bold">
        Проверки
      </h2>
      <p className="mt-2 text-sm text-on-surface-variant">
        Проверки считает код по правилам стиля и по общим правилам текста. Блокирующие не дают уйти
        на ревью, пока автор не подтвердит их с комментарием.
      </p>

      {checks.length === 0 ? (
        <p className="mt-4 text-sm text-on-surface-variant">
          {versionNumber === null
            ? 'Проверки появятся после генерации или сохранения версии.'
            : 'Нарушений не найдено.'}
        </p>
      ) : (
        <>
          <p className="mt-4 text-sm font-medium">
            {blocking === 0
              ? 'Блокирующих проверок нет'
              : `Блокирующих проверок: ${blocking}. Материал не пройдёт на ревью`}
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {checks.map((item, index) => (
              <li
                key={`${item.id}-${item.start ?? 'нет позиции'}-${index}`}
                className="flex flex-col gap-1 rounded-xl border border-outline-variant p-3 text-sm"
              >
                <p className="font-medium">
                  {labelOf(item)} · {CHECK_SEVERITY_LABELS[item.severity]}
                  {item.decision === 'confirmed' ? ' · подтверждено' : ''}
                </p>
                <p>{item.message}</p>
                {item.excerpt !== undefined ? (
                  <p className="text-on-surface-variant">Фрагмент: «{item.excerpt}»</p>
                ) : null}
                {item.decision === 'confirmed' && item.comment !== undefined ? (
                  <p className="text-on-surface-variant">Комментарий автора: {item.comment}</p>
                ) : null}
                {canConfirm && item.decision !== 'confirmed' && openIndex === index ? (
                  <ConfirmForm
                    comment={comment}
                    onComment={setComment}
                    busy={busyIndex === index}
                    onConfirm={() => void confirm(index)}
                    onCancel={() => setOpenIndex(undefined)}
                  />
                ) : null}
                {canConfirm && item.decision !== 'confirmed' && openIndex !== index ? (
                  <div>
                    <button
                      type="button"
                      className={BUTTON_SECONDARY}
                      onClick={() => setOpenIndex(index)}
                    >
                      Подтвердить
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}

      {error ? (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}
    </section>
  );
}

function ConfirmForm({
  comment,
  onComment,
  busy,
  onConfirm,
  onCancel,
}: {
  readonly comment: string;
  readonly onComment: (value: string) => void;
  readonly busy: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className={LABEL_CLASS}>
        <label htmlFor="check-comment">Почему проверку можно снять</label>
        <input
          id="check-comment"
          className={INPUT_CLASS}
          value={comment}
          maxLength={2000}
          onChange={(event) => onComment(event.target.value)}
          placeholder="Например: это номер пункта правил, а не данные"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BUTTON_PRIMARY} disabled={busy} onClick={onConfirm}>
          {busy ? 'Сохраняем…' : 'Подтвердить'}
        </button>
        <button type="button" className={BUTTON_SECONDARY} disabled={busy} onClick={onCancel}>
          Отмена
        </button>
      </div>
    </div>
  );
}

// У проверки есть идентификатор из списка движка, но в базе может оказаться
// проверка из будущей версии правил: тогда показываем её идентификатор.
function labelOf(item: VersionCheck): string {
  return CHECK_LABELS[item.id as AllCheckId] ?? item.id;
}
