import type { ArticleDetail } from '@dzenwriter/shared';
import { useEffect, useState } from 'react';
import { errorMessage } from '../../api/client';
import { fetchArticle, generateBrief, updateArticle } from '../../api/articles';
import { BUTTON_PRIMARY, BUTTON_SECONDARY, PANEL_CLASS } from '../../shared/ui/classes';
import { Notice } from '../../shared/ui/Notice';

interface BriefPanelProps {
  readonly article: ArticleDetail;
  readonly canEdit: boolean;
  readonly onChanged: (article: ArticleDetail) => void;
}

// Панель брифа: Markdown-план статьи, который уходит в промпт генерации текста.
// Генерация сохраняет бриф на сервере; кнопка «Сохранить» нужна для ручной правки.
export function BriefPanel({ article, canEdit, onChanged }: BriefPanelProps) {
  const [draft, setDraft] = useState(article.brief ?? '');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    setDraft(article.brief ?? '');
  }, [article.id, article.brief]);

  async function run() {
    setGenerating(true);
    setError(undefined);
    setFeedback(undefined);
    try {
      const response = await generateBrief(article.id);
      setDraft(response.brief);
      onChanged(await fetchArticle(article.id));
      setFeedback('Бриф сгенерирован и сохранён.');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setGenerating(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(undefined);
    setFeedback(undefined);
    try {
      const trimmed = draft.trim();
      const updated = await updateArticle(article.id, {
        expectedVersion: article.version,
        brief: trimmed.length === 0 ? null : draft,
      });
      setDraft(updated.brief ?? '');
      onChanged(updated);
      setFeedback('Бриф сохранён.');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="brief-title" className={PANEL_CLASS}>
      <h2 id="brief-title" className="font-display text-lg font-bold">
        Бриф статьи
      </h2>
      <p className="mt-2 text-sm text-on-surface-variant">
        План до генерации: боль читателя, тезисы, структура H2 и вопросы автору. Бриф уходит в
        промпт генерации текста.
      </p>

      <label className="mt-4 flex flex-col gap-2 text-sm">
        <span className="font-medium">Бриф (Markdown)</span>
        <textarea
          aria-label="Текст брифа"
          className="min-h-48 w-full rounded-lg border border-outline-variant bg-surface p-3 font-mono text-sm"
          value={draft}
          readOnly={!canEdit}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <p className="mt-1 text-xs text-on-surface-variant" aria-live="polite">
        Символов: {draft.length}
      </p>

      {canEdit ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={BUTTON_PRIMARY}
            disabled={generating || saving}
            aria-busy={generating}
            onClick={() => void run()}
          >
            {generating ? 'Генерируем бриф…' : 'Сгенерировать бриф'}
          </button>
          <button
            type="button"
            className={BUTTON_SECONDARY}
            disabled={generating || saving}
            onClick={() => void save()}
          >
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </div>
      ) : null}

      {feedback ? (
        <div className="mt-4">
          <Notice>{feedback}</Notice>
        </div>
      ) : null}
      {error ? (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}
    </section>
  );
}
