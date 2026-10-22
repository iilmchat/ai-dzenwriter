import {
  ARTICLE_STATUS_LABELS,
  CONTENT_EDITABLE_STATUSES,
  TONE_LABELS,
  updateArticleInputSchema,
  type ArticleDetail,
  type Tone,
} from '@dzenwriter/shared';
import { type FormEvent, useState } from 'react';
import { updateArticle } from '../../api/articles';
import { errorMessage } from '../../api/client';
import { dateToPlannedAt, parseKeywords, plannedAtToDate } from '../../lib/format';
import { BUTTON_PRIMARY, INPUT_CLASS, LABEL_CLASS, PANEL_CLASS } from '../../shared/ui/classes';
import { Notice } from '../../shared/ui/Notice';

interface ArticleEditFormProps {
  readonly article: ArticleDetail;
  readonly onSaved: (article: ArticleDetail) => void;
}

// Текст и параметры меняются до утверждения, дата публикации — до публикации.
// В запрос уходят только изменённые поля, поэтому версия растёт только при реальной правке.
export function ArticleEditForm({ article, onSaved }: ArticleEditFormProps) {
  const contentEditable = CONTENT_EDITABLE_STATUSES.includes(article.status);
  const [topic, setTopic] = useState(article.topic);
  const [keywords, setKeywords] = useState(article.keywords.join(', '));
  const [tone, setTone] = useState<Tone>(article.tone);
  const [plannedDate, setPlannedDate] = useState(plannedAtToDate(article.plannedAt));
  const [error, setError] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const changes: Record<string, unknown> = { expectedVersion: article.version };
    if (contentEditable) {
      if (topic.trim() !== article.topic) {
        changes.topic = topic.trim();
      }
      const nextKeywords = parseKeywords(keywords);
      if (nextKeywords.join('|') !== article.keywords.join('|')) {
        changes.keywords = nextKeywords;
      }
      if (tone !== article.tone) {
        changes.tone = tone;
      }
    }
    if (plannedDate !== plannedAtToDate(article.plannedAt)) {
      changes.plannedAt = plannedDate === '' ? null : dateToPlannedAt(plannedDate);
    }
    if (Object.keys(changes).length === 1) {
      setMessage('Изменений нет');
      return;
    }
    const parsed = updateArticleInputSchema.safeParse(changes);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Проверьте поля формы');
      return;
    }
    setError(undefined);
    setMessage(undefined);
    setBusy(true);
    try {
      const next = await updateArticle(article.id, parsed.data);
      setMessage('Изменения сохранены');
      onSaved(next);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="edit-title" className={PANEL_CLASS}>
      <h2 id="edit-title" className="font-display text-lg font-bold">
        Параметры материала
      </h2>
      {!contentEditable ? (
        <p className="mt-2 text-sm text-on-surface-variant">
          В статусе «{ARTICLE_STATUS_LABELS[article.status]}» меняется только плановая дата. Тему и
          текст вернёте в черновик переходом.
        </p>
      ) : null}
      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="mt-4 grid gap-4 md:grid-cols-2"
      >
        <label className={`${LABEL_CLASS} md:col-span-2`}>
          Тема
          <input
            className={INPUT_CLASS}
            value={topic}
            disabled={!contentEditable}
            onChange={(event) => setTopic(event.target.value)}
          />
        </label>
        <label className={LABEL_CLASS}>
          Ключевые слова через запятую
          <input
            className={INPUT_CLASS}
            value={keywords}
            disabled={!contentEditable}
            onChange={(event) => setKeywords(event.target.value)}
          />
        </label>
        <label className={LABEL_CLASS}>
          Тон
          <select
            className={INPUT_CLASS}
            value={tone}
            disabled={!contentEditable}
            onChange={(event) => setTone(event.target.value as Tone)}
          >
            {Object.entries(TONE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL_CLASS}>
          Плановая дата публикации
          <input
            type="date"
            className={INPUT_CLASS}
            value={plannedDate}
            onChange={(event) => setPlannedDate(event.target.value)}
          />
        </label>
        {error ? (
          <div className="md:col-span-2">
            <Notice tone="error">{error}</Notice>
          </div>
        ) : null}
        <div className="flex items-center gap-4 md:col-span-2">
          <button type="submit" className={BUTTON_PRIMARY} disabled={busy}>
            Сохранить
          </button>
          {message ? (
            <span aria-live="polite" className="text-sm text-on-surface-variant">
              {message}
            </span>
          ) : null}
        </div>
      </form>
    </section>
  );
}
