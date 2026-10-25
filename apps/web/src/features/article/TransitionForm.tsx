import {
  ARTICLE_STATUS_LABELS,
  REVIEW_RUBRIC_LABELS,
  transitionInputSchema,
  type ArticleDetail,
} from '@dzenwriter/shared';
import { type FormEvent, useState } from 'react';
import { transitionArticle } from '../../api/articles';
import { errorMessage } from '../../api/client';
import { BUTTON_PRIMARY, INPUT_CLASS, LABEL_CLASS, PANEL_CLASS } from '../../shared/ui/classes';
import { Notice } from '../../shared/ui/Notice';

type RubricKey = keyof typeof REVIEW_RUBRIC_LABELS;
const RUBRIC_KEYS = Object.keys(REVIEW_RUBRIC_LABELS) as RubricKey[];

interface TransitionFormProps {
  readonly article: ArticleDetail;
  readonly onDone: (article: ArticleDetail) => void;
}

// Переходы показываем все, что возможны из текущего статуса: недоступные объясняют причину.
export function TransitionForm({ article, onDone }: TransitionFormProps) {
  const [target, setTarget] = useState('');
  const [comment, setComment] = useState('');
  const [url, setUrl] = useState('');
  const [rubric, setRubric] = useState<Record<RubricKey, string>>({
    accuracy: '',
    style: '',
    readability: '',
    hooks: '',
    cliches: '',
  });
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const selected = article.transitions.find((option) => option.to === target);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected?.allowed) {
      return;
    }
    if (selected.needsComment && comment.trim() === '') {
      setError('Укажите комментарий: при возврате автору нужны пояснения');
      return;
    }
    if (selected.needsUrl && url.trim() === '') {
      setError('Укажите ссылку на статью в Дзене');
      return;
    }
    const filled = RUBRIC_KEYS.filter((key) => rubric[key] !== '');
    if (selected.to === 'approved' && filled.length > 0 && filled.length < RUBRIC_KEYS.length) {
      setError('Заполните все пять критериев рубрики или оставьте её пустой');
      return;
    }
    const parsed = transitionInputSchema.safeParse({
      to: selected.to,
      expectedVersion: article.version,
      comment: comment.trim() || undefined,
      externalUrl: url.trim() || undefined,
      rubric:
        selected.to === 'approved' && filled.length === RUBRIC_KEYS.length
          ? Object.fromEntries(RUBRIC_KEYS.map((key) => [key, Number(rubric[key])]))
          : undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Проверьте поля формы');
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      const next = await transitionArticle(article.id, parsed.data);
      setTarget('');
      setComment('');
      setUrl('');
      setRubric({ accuracy: '', style: '', readability: '', hooks: '', cliches: '' });
      onDone(next);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="transition-title" className={PANEL_CLASS}>
      <h2 id="transition-title" className="font-display text-lg font-bold">
        Перевести материал
      </h2>
      {article.transitions.length === 0 ? (
        <p className="mt-3 text-sm text-on-surface-variant">
          Из статуса «{ARTICLE_STATUS_LABELS[article.status]}» переходов нет.
        </p>
      ) : (
        <form onSubmit={(event) => void handleSubmit(event)} className="mt-4 flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Куда перевести</legend>
            {article.transitions.map((option) => (
              <label
                key={option.to}
                className={`flex flex-col gap-1 rounded-lg border border-outline-variant p-3 ${option.allowed ? '' : 'opacity-70'}`}
              >
                <span className="flex items-center gap-3 font-medium">
                  <input
                    type="radio"
                    name="transition"
                    value={option.to}
                    checked={target === option.to}
                    disabled={!option.allowed}
                    onChange={() => setTarget(option.to)}
                  />
                  {ARTICLE_STATUS_LABELS[option.to]}
                </span>
                {option.reason ? (
                  <span className="text-sm text-on-surface-variant">
                    Пока нельзя: {option.reason}
                  </span>
                ) : null}
              </label>
            ))}
          </fieldset>
          {selected?.needsComment ? (
            <label className={LABEL_CLASS}>
              Комментарий автору
              <textarea
                className={INPUT_CLASS}
                rows={3}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
              />
            </label>
          ) : null}
          {selected?.needsUrl ? (
            <label className={LABEL_CLASS}>
              Ссылка на статью в Дзене
              <input
                type="url"
                className={INPUT_CLASS}
                placeholder="https://dzen.ru/a/…"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
            </label>
          ) : null}
          {selected?.to === 'approved' ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">Рубрика редактора</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {RUBRIC_KEYS.map((key) => (
                  <label key={key} className={LABEL_CLASS}>
                    {REVIEW_RUBRIC_LABELS[key]}
                    <select
                      className={INPUT_CLASS}
                      value={rubric[key]}
                      onChange={(event) =>
                        setRubric((prev) => ({ ...prev, [key]: event.target.value }))
                      }
                    >
                      <option value="">—</option>
                      {[1, 2, 3, 4, 5].map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <span className="text-xs text-on-surface-variant">
                Необязательно: критерии по разделу 7.4 — точность, стиль, читаемость, крючки,
                штампы. Общая оценка в отчёте пилота будет средним по рубрике.
              </span>
            </fieldset>
          ) : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
          <div>
            <button type="submit" className={BUTTON_PRIMARY} disabled={!selected?.allowed || busy}>
              Перевести
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
