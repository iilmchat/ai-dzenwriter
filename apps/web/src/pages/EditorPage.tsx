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
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { fetchArticle, transitionArticle } from '../api/articles';
import { ApiError, errorMessage } from '../api/client';
import { startGeneration } from '../api/generation';
import {
  checkVersion,
  fetchVersion,
  fetchVersions,
  rollbackVersion,
  saveVersion,
} from '../api/versions';
import { ArticlePreview } from '../features/editor/ArticlePreview';
import { ClaimsEditor, type ClaimDraft, EditorMetadata } from '../features/editor/ClaimsEditor';
import { CommandPalette, type Command } from '../features/editor/CommandPalette';
import { ConflictDialog } from '../features/editor/ConflictDialog';
import { EditorChecksPanel } from '../features/editor/EditorChecksPanel';
import { MarkdownEditor, type MarkdownEditorHandle } from '../features/editor/MarkdownEditor';
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

const CHECK_DEBOUNCE_MS = 900;

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

const AUTOSAVE_DEBOUNCE_MS = 700;
const DRAFT_STORAGE_PREFIX = 'dzenwriter:draft:';

interface StoredDraft {
  readonly draft: Draft;
  readonly baseVersion: number;
  readonly savedAt: string;
}

interface Conflict {
  readonly localDraft: Draft;
  readonly latestArticle: ArticleDetail;
  readonly latestVersion: VersionDetail | null;
  readonly versions: readonly VersionSummary[];
  readonly showDiff: boolean;
}

function storageKey(articleId: string): string {
  return `${DRAFT_STORAGE_PREFIX}${articleId}`;
}

function readStoredDraft(articleId: string): StoredDraft | null {
  try {
    const raw = window.localStorage.getItem(storageKey(articleId));
    if (raw === null) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<StoredDraft>;
    if (
      typeof parsed.baseVersion !== 'number' ||
      typeof parsed.savedAt !== 'string' ||
      parsed.draft === undefined ||
      typeof parsed.draft.title !== 'string' ||
      typeof parsed.draft.articleMarkdown !== 'string'
    ) {
      return null;
    }
    return parsed as StoredDraft;
  } catch {
    return null;
  }
}

function writeStoredDraft(articleId: string, stored: StoredDraft): void {
  try {
    window.localStorage.setItem(storageKey(articleId), JSON.stringify(stored));
  } catch {
    // Хранилище может быть недоступно в приватном режиме: редактор продолжает работать.
  }
}

function clearStoredDraft(articleId: string): void {
  try {
    window.localStorage.removeItem(storageKey(articleId));
  } catch {
    // См. writeStoredDraft: отсутствие localStorage не блокирует редактирование.
  }
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
  const editor = useRef<MarkdownEditorHandle | null>(null);

  const load = useCallback(
    async (restoreLocalDraft = false) => {
      const [detail, list] = await Promise.all([fetchArticle(id), fetchVersions(id)]);
      const version =
        detail.currentVersionNumber === null
          ? null
          : await fetchVersion(id, detail.currentVersionNumber);
      const serverDraft = version === null ? EMPTY_DRAFT : toDraft(version);

      setArticle(detail);
      setVersions(list.items);
      setExpectedVersion(detail.version);
      setSavedDraft(serverDraft);
      setChecks(version?.checks ?? []);

      if (!restoreLocalDraft) {
        setDraft(serverDraft);
        clearStoredDraft(id);
        setAutosavedAt(undefined);
        return;
      }

      const stored = readStoredDraft(id);
      if (stored === null) {
        setDraft(serverDraft);
        return;
      }
      if (stored.baseVersion === detail.version) {
        setDraft(stored.draft);
        setNotice(`Восстановлен локальный черновик от ${formatDateTime(stored.savedAt)}.`);
        return;
      }
      setDraft(serverDraft);
      setConflict({
        localDraft: stored.draft,
        latestArticle: detail,
        latestVersion: version,
        versions: list.items,
        showDiff: false,
      });
    },
    [id],
  );

  useEffect(() => {
    let active = true;
    load(true)
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
      checkVersion(id, {
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
      }).then(
        (response: CheckVersionResponse) => setChecks(response.checks),
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
  const dirty = draftReady && JSON.stringify(draft) !== JSON.stringify(savedDraft);

  // Автосохранение локальное: версии создаёт только кнопка «Сохранить версию»,
  // иначе каждое нажатие клавиши плодило бы записи в истории.
  useEffect(() => {
    if (!draftReady || !article || !canEdit || conflict !== undefined) {
      return;
    }
    if (!dirty) {
      clearStoredDraft(id);
      setAutosavedAt(undefined);
      return;
    }
    const timer = window.setTimeout(() => {
      writeStoredDraft(id, {
        draft,
        baseVersion: expectedVersion,
        savedAt: new Date().toISOString(),
      });
      setAutosavedAt(new Date());
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [article, canEdit, conflict, dirty, draft, expectedVersion, id, draftReady]);

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
      });
      const next = toDraft(response.version);
      setDraft(next);
      setSavedDraft(next);
      setChecks(response.version.checks);
      setExpectedVersion(response.article.version);
      clearStoredDraft(id);
      setAutosavedAt(undefined);
      setNotice(`Сохранена версия ${response.version.number}.`);
      await load();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        await openConflict();
      } else {
        setError(errorMessage(cause));
      }
    } finally {
      setSaving(false);
    }
  }

  async function openConflict() {
    try {
      const [latestArticle, list] = await Promise.all([fetchArticle(id), fetchVersions(id)]);
      const latestVersion =
        latestArticle.currentVersionNumber === null
          ? null
          : await fetchVersion(id, latestArticle.currentVersionNumber);
      setConflict({
        localDraft: draft,
        latestArticle,
        latestVersion,
        versions: list.items,
        showDiff: false,
      });
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  function reloadLatest() {
    if (!conflict) {
      return;
    }
    const next = conflict.latestVersion === null ? EMPTY_DRAFT : toDraft(conflict.latestVersion);
    setArticle(conflict.latestArticle);
    setVersions([...conflict.versions]);
    setDraft(next);
    setSavedDraft(next);
    setChecks(conflict.latestVersion?.checks ?? []);
    setExpectedVersion(conflict.latestArticle.version);
    clearStoredDraft(id);
    setAutosavedAt(undefined);
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
      clearStoredDraft(id);
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

  const commands: Command[] = [
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
                : `Черновик сохранён локально ${formatDateTime(autosavedAt.toISOString())}`
              : 'Все изменения сохранены'}
        </p>
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_320px]">
        <section className={PANEL_CLASS} aria-label="Исходник">
          <h2 className="font-display text-lg font-bold">Исходник</h2>
          <div className={LABEL_CLASS}>
            <label htmlFor="article-title">Заголовок</label>
            <input
              id="article-title"
              className={INPUT_CLASS}
              value={draft.title}
              maxLength={300}
              disabled={!canEdit}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </div>
          <div className="mt-3 min-h-[420px]">
            <MarkdownEditor
              ref={editor}
              value={draft.articleMarkdown}
              placeholder="Текст статьи в Markdown"
              onChange={(articleMarkdown) => setDraft({ ...draft, articleMarkdown })}
              onSave={() => void save()}
              onGenerate={() => void generate()}
              onCommandPalette={() => setPaletteOpen(true)}
            />
          </div>
        </section>

        <section className={PANEL_CLASS} aria-label="Предпросмотр">
          <h2 className="font-display text-lg font-bold">Предпросмотр, как в Дзене</h2>
          <ArticlePreview title={draft.title} markdown={draft.articleMarkdown} checks={checks} />
        </section>

        <EditorChecksPanel
          checks={checks}
          onFocus={(check) =>
            editor.current?.focusRange(
              check.start !== undefined && check.end !== undefined
                ? { from: check.start, to: check.end }
                : null,
            )
          }
        />
      </div>

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

      <CommandPalette
        open={paletteOpen}
        commands={commands}
        onClose={() => setPaletteOpen(false)}
      />
    </div>
  );
}

function toDraft(version: VersionDetail): Draft {
  return {
    title: version.title,
    articleMarkdown: version.articleMarkdown,
    seoTitle: version.seoTitle,
    tags: version.tags,
    description: version.description,
    imagePrompt: version.imagePrompt,
    advertisingLabel: version.advertisingLabel,
    disclaimerText: version.disclaimerText,
    claims: version.claims.map((claim) => ({
      text: claim.text,
      type: claim.type as ClaimType,
      factIds: claim.factIds,
    })),
  };
}
