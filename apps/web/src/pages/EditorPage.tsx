import {
  ARTICLE_FORMAT_LABELS,
  ARTICLE_STATUS_LABELS,
  type ArticleDetail,
  type CheckVersionResponse,
  type ClaimType,
  type VersionCheck,
  type VersionDetail,
  type VersionSummary,
} from '@dzenwriter/shared';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  confirmCheck,
  fetchArticle,
  generateTitleOptions,
  saveDraft,
  transitionArticle,
} from '../api/articles';
import { ApiError, errorMessage } from '../api/client';
import { startGeneration } from '../api/generation';
import { createReviewComment } from '../api/reviews';
import {
  checkVersion,
  fetchVersion,
  fetchVersions,
  rollbackVersion,
  saveVersion,
} from '../api/versions';
import { ClaimsEditor, type ClaimDraft, EditorMetadata } from '../features/editor/ClaimsEditor';
import { CommandPalette, type Command } from '../features/editor/CommandPalette';
import { ConflictDialog } from '../features/editor/ConflictDialog';
import { EditorChecksPanel } from '../features/editor/EditorChecksPanel';
import { FragmentRegenerateDialog } from '../features/editor/FragmentRegenerateDialog';
import type { EditorRange, MarkdownEditorHandle } from '../features/editor/MarkdownEditor';
import { ReviewCommentDialog } from '../features/editor/ReviewCommentDialog';
import { ReviewCommentsPanel } from '../features/editor/ReviewCommentsPanel';
import { VersionHistory } from '../features/editor/VersionHistory';
import { formatDateTime } from '../lib/format';
import { useSession } from '../session/SessionContext';
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  FOCUS_RING,
  INPUT_CLASS,
  LABEL_CLASS,
  PANEL_CLASS,
} from '../shared/ui/classes';
import { Notice } from '../shared/ui/Notice';

// Тяжёлые части редактора грузятся отдельно: CodeMirror и markdown-рендер
// не попадают в чанк страницы и скачиваются только при её открытии.
const ArticlePreview = lazy(() =>
  import('../features/editor/ArticlePreview').then((module) => ({
    default: module.ArticlePreview,
  })),
);
const MarkdownEditor = lazy(() =>
  import('../features/editor/MarkdownEditor').then((module) => ({
    default: module.MarkdownEditor,
  })),
);

const CHECK_DEBOUNCE_MS = 900;
// Окружение фрагмента для промпта: то же, что видит редактор при выделении.
const FRAGMENT_CONTEXT_CHARS = 400;

interface FragmentTarget {
  readonly range: EditorRange;
  readonly selectedText: string;
  readonly contextBefore: string;
  readonly contextAfter: string;
}

interface CommentTarget {
  readonly selectedText: string;
  readonly startOffset: number;
  readonly endOffset: number;
}

interface Draft {
  readonly title: string;
  readonly articleMarkdown: string;
  readonly seoTitle: string;
  readonly tags: readonly string[];
  readonly description: string;
  readonly imagePrompt: string;
  readonly advertisingLabel: boolean;
  readonly disclaimerText: string | null;
  readonly claims: readonly ClaimDraft[];
}

const EMPTY_DRAFT: Draft = {
  title: '',
  articleMarkdown: '',
  seoTitle: '',
  tags: [],
  description: '',
  imagePrompt: '',
  advertisingLabel: false,
  disclaimerText: null,
  claims: [],
};

// Автосохранение на сервер: пауза в три секунды, чтобы не отправлять каждый символ.
const AUTOSAVE_DEBOUNCE_MS = 3000;

interface Conflict {
  readonly localDraft: Draft;
  readonly latestArticle: ArticleDetail;
  readonly latestVersion: VersionDetail | null;
  readonly versions: readonly VersionSummary[];
  readonly showDiff: boolean;
}

// Редактор материала: исходник, предпросмотр в духе Дзена и панель проверок.
export function EditorPage() {
  const { id = '' } = useParams();
  const { state: session } = useSession();
  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [savedDraft, setSavedDraft] = useState<Draft>(EMPTY_DRAFT);
  const [draftReady, setDraftReady] = useState(false);
  const [autosavedAt, setAutosavedAt] = useState<Date | undefined>(undefined);
  const [conflict, setConflict] = useState<Conflict | undefined>(undefined);
  const [checks, setChecks] = useState<VersionCheck[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expectedVersion, setExpectedVersion] = useState(1);
  const [selection, setSelection] = useState<EditorRange | null>(null);
  const [fragmentTarget, setFragmentTarget] = useState<FragmentTarget | null>(null);
  const [titleOptions, setTitleOptions] = useState<string[] | null>(null);
  const [titlesLoading, setTitlesLoading] = useState(false);
  const [commentTarget, setCommentTarget] = useState<CommentTarget | undefined>(undefined);
  const [commentSaving, setCommentSaving] = useState(false);
  const [commentsRefreshKey, setCommentsRefreshKey] = useState(0);
  const selectionRef = useRef<EditorRange | null>(null);
  const editor = useRef<MarkdownEditorHandle | null>(null);
  // Версию черновика храним и в ref: ответ автосохранения приходит асинхронно,
  // а следующий запрос должен взять уже новую версию.
  const draftVersionRef = useRef(0);
  const autosaveInFlight = useRef(false);
  const pendingAutosave = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const load = useCallback(async () => {
    const [detail, list] = await Promise.all([fetchArticle(id), fetchVersions(id)]);
    const version =
      detail.currentVersionNumber === null
        ? null
        : await fetchVersion(id, detail.currentVersionNumber);
    // Пока серверный черновик не зафиксирован версией, редактор открывает его.
    const versionDraft = version === null ? EMPTY_DRAFT : toDraft(version);
    const openDraft = detail.draft === null ? versionDraft : toDraft(detail.draft);
    const nextDraftVersion = detail.draft?.version ?? 0;

    setArticle(detail);
    setVersions(list.items);
    setExpectedVersion(detail.version);
    setSavedDraft(versionDraft);
    setDraft(openDraft);
    setChecks(version?.checks ?? []);
    draftVersionRef.current = nextDraftVersion;
    setAutosavedAt(detail.draft === null ? undefined : new Date(detail.draft.updatedAt));
    if (detail.draft !== null) {
      setNotice(`Загружен черновик с сервера от ${formatDateTime(detail.draft.updatedAt)}.`);
    }
  }, [id]);

  useEffect(() => {
    let active = true;
    load()
      .then(() => {
        if (active) {
          setDraftReady(true);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(errorMessage(cause));
        }
      });
    return () => {
      active = false;
    };
  }, [load]);

  // Проверки считаются на сервере по ходу правки: пауза в полсекунды, чтобы не спамить.
  useEffect(() => {
    if (!article) {
      return;
    }
    const timer = setTimeout(() => {
      checkVersion(id, draftFields(draft)).then(
        (response: CheckVersionResponse) =>
          setChecks((previous) => mergeConfirmedChecks(previous, response.checks)),
        () => undefined,
      );
    }, CHECK_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [article, draft, id]);

  const user = session.phase === 'authenticated' ? session.user : undefined;
  const canEdit =
    article !== null &&
    user !== undefined &&
    (user.id === article.owner.id || user.role === 'admin') &&
    article.status !== 'archived' &&
    article.status !== 'published';
  // Комментировать фрагменты может ревьюер или администратор.
  const canComment = user !== undefined && (user.role === 'reviewer' || user.role === 'admin');
  const canResolveComments =
    canComment || (user !== undefined && article !== null && user.id === article.owner.id);
  const dirty = draftReady && JSON.stringify(draft) !== JSON.stringify(savedDraft);

  // Конфликт версий: показываем локальную правку рядом с последней версией с сервера.
  const openConflict = useCallback(
    async (localDraft: Draft) => {
      try {
        const [latestArticle, list] = await Promise.all([fetchArticle(id), fetchVersions(id)]);
        const latestVersion =
          latestArticle.currentVersionNumber === null
            ? null
            : await fetchVersion(id, latestArticle.currentVersionNumber);
        setConflict({
          localDraft,
          latestArticle,
          latestVersion,
          versions: list.items,
          showDiff: false,
        });
      } catch (cause) {
        setError(errorMessage(cause));
      }
    },
    [id],
  );

  // Отправка черновика: берём самый свежий текст из ref, чтобы ответ предыдущего
  // запроса не отправил устаревшую правку.
  const saveDraftNow = useCallback(() => {
    if (autosaveInFlight.current) {
      pendingAutosave.current = true;
      return;
    }
    autosaveInFlight.current = true;
    saveDraft(id, {
      expectedVersion: draftVersionRef.current,
      ...draftFields(draftRef.current),
    })
      .then((saved) => {
        draftVersionRef.current = saved.version;
        setAutosavedAt(new Date(saved.updatedAt));
      })
      .catch((cause: unknown) => {
        if (cause instanceof ApiError && cause.status === 409) {
          void openConflict(draftRef.current);
        } else {
          setError(errorMessage(cause));
        }
      })
      .finally(() => {
        autosaveInFlight.current = false;
        if (pendingAutosave.current) {
          pendingAutosave.current = false;
          window.setTimeout(saveDraftNow, 0);
        }
      });
  }, [id, openConflict]);

  // Автосохранение на сервер: версии создаёт только кнопка «Сохранить версию»,
  // иначе каждое нажатие клавиши плодило бы записи в истории.
  useEffect(() => {
    if (!draftReady || !article || !canEdit || conflict !== undefined) {
      return;
    }
    if (!dirty) {
      return;
    }
    const timer = window.setTimeout(saveDraftNow, AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [article, canEdit, conflict, dirty, draft, draftReady, saveDraftNow]);

  useEffect(() => {
    if (!dirty && conflict === undefined) {
      return;
    }
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [conflict, dirty]);

  async function save() {
    if (!article) {
      return;
    }
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const response = await saveVersion(id, {
        expectedVersion,
        ...draftFields(draft),
      });
      const next = toDraft(response.version);
      setDraft(next);
      setSavedDraft(next);
      setChecks(response.version.checks);
      setExpectedVersion(response.article.version);
      // Версия зафиксировала правки: сервер удалил черновик, локальная версия сбрасывается.
      draftVersionRef.current = 0;
      setAutosavedAt(undefined);
      setNotice(`Сохранена версия ${response.version.number}.`);
      await load();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        await openConflict(draft);
      } else {
        setError(errorMessage(cause));
      }
    } finally {
      setSaving(false);
    }
  }

  function reloadLatest() {
    if (!conflict) {
      return;
    }
    const latestDraft = conflict.latestArticle.draft;
    const next =
      latestDraft !== null
        ? toDraft(latestDraft)
        : conflict.latestVersion === null
          ? EMPTY_DRAFT
          : toDraft(conflict.latestVersion);
    const nextDraftVersion = latestDraft?.version ?? 0;
    setArticle(conflict.latestArticle);
    setVersions([...conflict.versions]);
    setDraft(next);
    setSavedDraft(conflict.latestVersion === null ? EMPTY_DRAFT : toDraft(conflict.latestVersion));
    setChecks(conflict.latestVersion?.checks ?? []);
    setExpectedVersion(conflict.latestArticle.version);
    draftVersionRef.current = nextDraftVersion;
    setAutosavedAt(latestDraft === null ? undefined : new Date(latestDraft.updatedAt));
    setConflict(undefined);
    setError(undefined);
    setNotice('Загружена последняя версия с сервера.');
  }

  async function generate() {
    if (dirty || conflict !== undefined) {
      setError('Сначала сохраните изменения: генерация создаст новую версию поверх текущей.');
      return;
    }
    setError(undefined);
    setNotice(undefined);
    try {
      for await (const event of startGeneration(id, { idempotencyKey: crypto.randomUUID() })) {
        if (event.type === 'result' && event.result.status === 'succeeded') {
          setNotice(`Создана версия ${event.result.versionNumber ?? ''}.`);
          await load();
        }
        if (event.type === 'result' && event.result.status === 'needs_input') {
          setNotice('Модели не хватило фактов: ответьте на вопросы и запустите снова.');
        }
        if (event.type === 'result' && event.result.status === 'failed') {
          setError('Генерация не удалась: текст не изменился.');
        }
      }
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function rollback(number: number) {
    setError(undefined);
    try {
      const response = await rollbackVersion(id, number);
      const next = toDraft(response.version);
      setDraft(next);
      setSavedDraft(next);
      setChecks(response.version.checks);
      setExpectedVersion(response.article.version);
      draftVersionRef.current = 0;
      setAutosavedAt(undefined);
      setNotice(`Версия ${number} восстановлена как версия ${response.version.number}.`);
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function openVersion(number: number) {
    setError(undefined);
    try {
      const version = await fetchVersion(id, number);
      setDraft(toDraft(version));
      setChecks(version.checks);
      // Шапка показывает именно открытую версию, а не последнюю сохранённую.
      setArticle((current) =>
        current === null ? current : { ...current, currentVersionNumber: version.number },
      );
      setNotice(`Открыта версия ${number}.`);
      setHistoryOpen(false);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function sendToReview() {
    if (!article) {
      return;
    }
    if (dirty || conflict !== undefined) {
      setError('Сначала сохраните изменения: на ревью уходит последняя сохранённая версия.');
      return;
    }
    setError(undefined);
    try {
      await transitionArticle(id, { to: 'in_review', expectedVersion: article.version });
      setNotice('Материал отправлен на ревью.');
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  function trackSelection(range: EditorRange | null) {
    selectionRef.current = range;
    setSelection(range);
  }

  // Выделение уже пришло из CodeMirror: диапазон берём из последнего состояния.
  function openFragmentDialog(selectedText: string, contextBefore: string, contextAfter: string) {
    const range = selectionRef.current;
    if (range === null || selectedText.length === 0) {
      setError('Сначала выделите фрагмент текста в редакторе.');
      return;
    }
    setError(undefined);
    setFragmentTarget({ range, selectedText, contextBefore, contextAfter });
  }

  function openSelectedFragment() {
    const range = selectionRef.current;
    if (range === null || range.from === range.to) {
      setError('Сначала выделите фрагмент текста в редакторе.');
      return;
    }
    const markdown = draft.articleMarkdown;
    openFragmentDialog(
      markdown.slice(range.from, range.to),
      markdown.slice(Math.max(0, range.from - FRAGMENT_CONTEXT_CHARS), range.from),
      markdown.slice(range.to, Math.min(markdown.length, range.to + FRAGMENT_CONTEXT_CHARS)),
    );
  }

  // Применение результата: заменяем диапазон в CodeMirror, проверки перезапустит
  // обычный эффект по изменению черновика. Версия создаётся только «Сохранить».
  function applyFragment(text: string) {
    if (fragmentTarget === null) {
      return;
    }
    editor.current?.replaceRange(fragmentTarget.range, text);
    setFragmentTarget(null);
    setSelection(null);
    selectionRef.current = null;
    setNotice('Фрагмент обновлён в черновике. Сохраните версию, чтобы зафиксировать правку.');
  }

  function setCommentTargetFrom(selectedText: string, startOffset: number, endOffset: number) {
    if (selectedText.trim().length === 0) {
      setError('Сначала выделите фрагмент текста в редакторе.');
      return;
    }
    setError(undefined);
    setCommentTarget({ selectedText, startOffset, endOffset });
  }

  function openSelectedComment() {
    const range = selectionRef.current;
    if (range === null || range.from === range.to) {
      setError('Сначала выделите фрагмент текста в редакторе.');
      return;
    }
    setCommentTargetFrom(draft.articleMarkdown.slice(range.from, range.to), range.from, range.to);
  }

  async function saveComment(comment: string) {
    if (commentTarget === undefined || article === null) {
      return;
    }
    const versionNumber = article.currentVersionNumber;
    if (versionNumber === null) {
      setError('Сначала сохраните версию: комментарий привязывается к сохранённому тексту.');
      return;
    }
    setCommentSaving(true);
    setError(undefined);
    try {
      await createReviewComment(id, versionNumber, {
        versionNumber,
        comment,
        selectedText: commentTarget.selectedText,
        startOffset: commentTarget.startOffset,
        endOffset: commentTarget.endOffset,
      });
      setCommentTarget(undefined);
      setCommentsRefreshKey((value) => value + 1);
      setNotice(`Комментарий добавлен к версии ${versionNumber}.`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setCommentSaving(false);
    }
  }

  async function handleConfirmCheck(checkIndex: number, comment: string): Promise<void> {
    if (article === null) {
      throw new Error('Материал ещё не загружен');
    }
    const versionNumber = article.currentVersionNumber;
    if (versionNumber === null) {
      throw new Error('Сначала сохраните версию: подтверждение привязано к версии');
    }
    const updated = await confirmCheck(id, versionNumber, checkIndex, comment);
    setChecks(updated.checks);
    setNotice('Проверка подтверждена.');
    await load();
  }

  async function suggestTitles() {
    setTitlesLoading(true);
    setError(undefined);
    try {
      const response = await generateTitleOptions(id);
      setTitleOptions(response.titles);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setTitlesLoading(false);
    }
  }

  const commands: Command[] = [
    {
      id: 'fragment',
      title: 'Перегенерировать фрагмент',
      hint: 'Ctrl+Shift+R',
      run: () => openSelectedFragment(),
    },
    {
      id: 'comment',
      title: 'Комментировать фрагмент',
      hint: 'Ctrl+Shift+M',
      run: () => openSelectedComment(),
    },
    { id: 'save', title: 'Сохранить версию', hint: 'Ctrl+S', run: () => void save() },
    {
      id: 'generate',
      title: 'Сгенерировать заново',
      hint: 'Ctrl+Enter',
      run: () => void generate(),
    },
    { id: 'review', title: 'Отправить на ревью', run: () => void sendToReview() },
    { id: 'history', title: 'История версий', run: () => setHistoryOpen(true) },
    {
      id: 'close',
      title: 'Вернуться к материалу',
      run: () => window.location.assign(`/articles/${id}`),
    },
  ];

  if (article === null) {
    return error !== undefined ? (
      <Notice tone="error">{error}</Notice>
    ) : (
      <Notice>Загружаем…</Notice>
    );
  }

  const blocking = checks.filter(
    (check) => check.severity === 'block' && check.decision !== 'confirmed',
  ).length;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link
          to={`/articles/${article.id}`}
          className={`w-fit text-sm font-medium hover:underline ${FOCUS_RING}`}
          onClick={(event) => {
            if (
              (dirty || conflict !== undefined) &&
              !window.confirm('Есть несохранённые изменения. Выйти из редактора?')
            ) {
              event.preventDefault();
            }
          }}
        >
          ← К материалу
        </Link>
        <h1 className="font-display text-2xl font-bold leading-tight">
          {draft.title || article.topic}
        </h1>
        <p className="text-sm text-on-surface-variant">
          {article.styleName} · {ARTICLE_FORMAT_LABELS[article.format]} ·{' '}
          {ARTICLE_STATUS_LABELS[article.status]} · версия {article.currentVersionNumber ?? '—'} ·{' '}
          {draft.articleMarkdown.length} знаков
        </p>
        <p aria-live="polite" className="text-xs text-on-surface-variant">
          {conflict !== undefined
            ? 'Есть конфликт версий: решите его в диалоге.'
            : dirty
              ? autosavedAt === undefined
                ? 'Есть несохранённые изменения'
                : `Черновик сохранён на сервере ${formatDateTime(autosavedAt.toISOString())}`
              : 'Все изменения сохранены'}
        </p>
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_320px]">
        <section className={PANEL_CLASS} aria-label="Исходник">
          <h2 className="font-display text-lg font-bold">Исходник</h2>
          <div className={LABEL_CLASS}>
            <label htmlFor="article-title">Заголовок</label>
            <div className="flex gap-2">
              <input
                id="article-title"
                className={INPUT_CLASS}
                value={draft.title}
                maxLength={300}
                disabled={!canEdit}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
              <button
                type="button"
                className={`${BUTTON_SECONDARY} shrink-0 px-4 py-2 text-sm`}
                disabled={!canEdit || titlesLoading}
                onClick={() => void suggestTitles()}
              >
                {titlesLoading ? 'Подбираем…' : 'Варианты'}
              </button>
            </div>
            {titleOptions !== null && titleOptions.length > 0 ? (
              <ul
                className="mt-1 flex flex-col gap-1 rounded-lg border border-outline-variant bg-surface p-2"
                aria-label="Варианты заголовка"
              >
                {titleOptions.map((title) => (
                  <li key={title}>
                    <button
                      type="button"
                      className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-secondary-container"
                      onClick={() => {
                        setDraft({ ...draft, title });
                        setTitleOptions(null);
                      }}
                    >
                      {title}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={`${BUTTON_SECONDARY} px-4 py-2 text-sm`}
              disabled={!canEdit || selection === null}
              onClick={openSelectedFragment}
            >
              Перегенерировать фрагмент
            </button>
            <button
              type="button"
              className={`${BUTTON_SECONDARY} px-4 py-2 text-sm`}
              disabled={!canComment || selection === null || article.currentVersionNumber === null}
              onClick={openSelectedComment}
            >
              Комментировать
            </button>
            <span className="text-xs text-on-surface-variant">
              Выделите текст; ревьюер может нажать Ctrl+Shift+M
            </span>
          </div>
          <div className="mt-3 min-h-[420px]">
            <Suspense fallback={<div>Загрузка...</div>}>
              <MarkdownEditor
                ref={editor}
                value={draft.articleMarkdown}
                placeholder="Текст статьи в Markdown"
                onChange={(articleMarkdown) => setDraft({ ...draft, articleMarkdown })}
                onSave={() => void save()}
                onGenerate={() => void generate()}
                onCommandPalette={() => setPaletteOpen(true)}
                onRegenerateFragment={openFragmentDialog}
                onCreateComment={(selectedText, startOffset, endOffset) => {
                  if (canComment) {
                    setCommentTargetFrom(selectedText, startOffset, endOffset);
                  }
                }}
                onSelectionChange={trackSelection}
              />
            </Suspense>
          </div>
        </section>

        <section className={PANEL_CLASS} aria-label="Предпросмотр">
          <h2 className="font-display text-lg font-bold">Предпросмотр, как в Дзене</h2>
          <Suspense fallback={<div>Загрузка...</div>}>
            <ArticlePreview title={draft.title} markdown={draft.articleMarkdown} checks={checks} />
          </Suspense>
        </section>

        <EditorChecksPanel
          checks={checks}
          onConfirm={canEdit ? handleConfirmCheck : undefined}
          onFocus={(check) =>
            editor.current?.focusRange(
              check.start !== undefined && check.end !== undefined
                ? { from: check.start, to: check.end }
                : null,
            )
          }
        />
      </div>

      <ReviewCommentsPanel
        articleId={article.id}
        versionNumber={article.currentVersionNumber}
        canResolve={canResolveComments}
        refreshKey={commentsRefreshKey}
        onFocus={(comment) =>
          editor.current?.focusRange({
            from: comment.startOffset,
            to: comment.endOffset,
          })
        }
      />

      <EditorMetadata
        seoTitle={draft.seoTitle}
        tags={draft.tags}
        description={draft.description}
        imagePrompt={draft.imagePrompt}
        seoTitleMax={70}
        onChange={(fields) => setDraft({ ...draft, ...fields })}
      />

      <ClaimsEditor
        claims={draft.claims}
        facts={article.facts.map((fact) => ({
          label: fact.label,
          text: fact.text,
          status: fact.status,
        }))}
        onChange={(claims) => setDraft({ ...draft, claims })}
      />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={BUTTON_PRIMARY}
          disabled={!canEdit || saving || conflict !== undefined}
          onClick={() => void save()}
        >
          {saving ? 'Сохраняем…' : 'Сохранить версию'}
        </button>
        <button
          type="button"
          className={BUTTON_SECONDARY}
          disabled={!canEdit || dirty || conflict !== undefined}
          onClick={() => void generate()}
        >
          Сгенерировать заново
        </button>
        <button
          type="button"
          className={BUTTON_SECONDARY}
          disabled={!canEdit || blocking > 0 || dirty || conflict !== undefined}
          onClick={() => void sendToReview()}
        >
          На ревью
        </button>
        <button
          type="button"
          className={BUTTON_SECONDARY}
          onClick={() => setHistoryOpen((value) => !value)}
        >
          История версий
        </button>
        {blocking > 0 ? (
          <span className="text-sm text-on-surface-variant">
            Заблокировано: {blocking} проверк{blocking === 1 ? 'а' : 'и'}
          </span>
        ) : null}
      </div>

      {notice !== undefined ? <Notice>{notice}</Notice> : null}
      {error !== undefined ? <Notice tone="error">{error}</Notice> : null}

      {historyOpen ? (
        <div className="fixed inset-y-0 right-0 z-40 w-full max-w-md overflow-auto border-l border-outline-variant bg-surface p-6">
          <button type="button" className={BUTTON_SECONDARY} onClick={() => setHistoryOpen(false)}>
            Закрыть
          </button>
          <div className="mt-4">
            <VersionHistory
              articleId={article.id}
              versions={versions}
              currentNumber={article.currentVersionNumber}
              onOpen={(number) => void openVersion(number)}
              onRollback={(number) => void rollback(number)}
            />
          </div>
        </div>
      ) : null}

      {conflict ? (
        <ConflictDialog
          localMarkdown={conflict.localDraft.articleMarkdown}
          latestVersion={conflict.latestVersion}
          showDiff={conflict.showDiff}
          onCompare={() => setConflict({ ...conflict, showDiff: !conflict.showDiff })}
          onReload={reloadLatest}
        />
      ) : null}

      {fragmentTarget !== null ? (
        <FragmentRegenerateDialog
          articleId={article.id}
          selectedText={fragmentTarget.selectedText}
          contextBefore={fragmentTarget.contextBefore}
          contextAfter={fragmentTarget.contextAfter}
          onApply={applyFragment}
          onClose={() => setFragmentTarget(null)}
        />
      ) : null}

      {commentTarget !== undefined ? (
        <ReviewCommentDialog
          selectedText={commentTarget.selectedText}
          saving={commentSaving}
          onSubmit={(comment) => void saveComment(comment)}
          onCancel={() => setCommentTarget(undefined)}
        />
      ) : null}

      <CommandPalette
        open={paletteOpen}
        commands={commands}
        onClose={() => setPaletteOpen(false)}
      />
    </div>
  );
}

// Поля, общие для версии и серверного черновика: из них собирается состояние редактора.
interface DraftSource {
  readonly title: string;
  readonly articleMarkdown: string;
  readonly seoTitle: string;
  readonly tags: readonly string[];
  readonly description: string;
  readonly imagePrompt: string;
  readonly advertisingLabel: boolean;
  readonly disclaimerText: string | null;
  readonly claims: readonly ClaimDraft[];
}

// Live Check присылает новый массив проверок без решений автора. Переносим
// подтверждение на ту же проверку по позиции фрагмента или по excerpt.
export function mergeConfirmedChecks(
  previous: readonly VersionCheck[],
  next: readonly VersionCheck[],
): VersionCheck[] {
  return next.map((check) => {
    const confirmed = previous.find((old) => {
      if (old.decision !== 'confirmed' || old.id !== check.id) {
        return false;
      }
      const sameSpan =
        old.start === check.start &&
        old.end === check.end &&
        (old.start !== undefined || old.end !== undefined);
      const sameExcerpt =
        old.excerpt !== undefined && check.excerpt !== undefined && old.excerpt === check.excerpt;
      return sameSpan || sameExcerpt;
    });
    if (!confirmed) {
      return check;
    }
    return {
      ...check,
      decision: 'confirmed',
      comment: confirmed.comment,
      confirmedBy: confirmed.confirmedBy,
      confirmedAt: confirmed.confirmedAt,
    };
  });
}

function toDraft(source: DraftSource): Draft {
  return {
    title: source.title,
    articleMarkdown: source.articleMarkdown,
    seoTitle: source.seoTitle,
    tags: source.tags,
    description: source.description,
    imagePrompt: source.imagePrompt,
    advertisingLabel: source.advertisingLabel,
    disclaimerText: source.disclaimerText,
    claims: source.claims.map((claim) => ({
      text: claim.text,
      type: claim.type as ClaimType,
      factIds: claim.factIds,
    })),
  };
}

// Тело сохранения версии и черновика: поля одинаковые, у версии добавляется expectedVersion.
function draftFields(draft: Draft) {
  return {
    title: draft.title,
    articleMarkdown: draft.articleMarkdown,
    seoTitle: draft.seoTitle,
    tags: [...draft.tags],
    description: draft.description,
    imagePrompt: draft.imagePrompt,
    advertisingLabel: draft.advertisingLabel,
    disclaimerText: draft.disclaimerText,
    claims: draft.claims.map((claim) => ({
      text: claim.text,
      type: claim.type,
      factIds: [...claim.factIds],
    })),
  };
}
