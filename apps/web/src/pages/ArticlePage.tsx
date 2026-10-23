import {
  ARTICLE_FORMAT_LABELS,
  ARTICLE_STATUS_LABELS,
  CONTENT_EDITABLE_STATUSES,
  TONE_LABELS,
  type ArticleDetail,
  type VersionDetail,
} from '@dzenwriter/shared';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { fetchArticle } from '../api/articles';
import { errorMessage } from '../api/client';
import { exportUrl } from '../api/publications';
import { fetchVersion } from '../api/versions';
import { ArticleEditForm } from '../features/article/ArticleEditForm';
import { ArticleFactsPanel } from '../features/article/ArticleFactsPanel';
import { ChecksPanel } from '../features/article/ChecksPanel';
import { GenerationPanel } from '../features/article/GenerationPanel';
import { TransitionForm } from '../features/article/TransitionForm';
import { useCatalog } from '../features/catalog/useCatalog';
import { formatDate, formatDateTime } from '../lib/format';
import { useSession } from '../session/SessionContext';
import { BUTTON_SECONDARY, FOCUS_RING, PANEL_CLASS } from '../shared/ui/classes';
import { Notice } from '../shared/ui/Notice';

// Текст версии тянет react-markdown. Отдельный чанк не грузит его тем, кто открыл
// доску или другой раздел, и не раздувает стартовый бандл.
const ArticleTextView = lazy(() =>
  import('../features/article/ArticleTextView').then((module) => ({
    default: module.ArticleTextView,
  })),
);

type ArticleState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly article: ArticleDetail }
  | { readonly phase: 'error'; readonly message: string };

type VersionState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly version: VersionDetail }
  | { readonly phase: 'error'; readonly message: string };

const ORIGIN_LABELS: Record<string, string> = { generated: 'генерация', manual: 'ручная правка' };
const REVIEW_LABELS: Record<string, string> = {
  approved: 'Утверждено',
  changes_requested: 'Возвращено на доработку',
};
const PUBLICATION_LABELS: Record<string, string> = {
  scheduled: 'Запланирована',
  published: 'Опубликована',
};

export function ArticlePage() {
  const { id = '' } = useParams();
  const { state: session } = useSession();
  const catalog = useCatalog();
  const [state, setState] = useState<ArticleState>({ phase: 'loading' });
  const [versionState, setVersionState] = useState<VersionState>({ phase: 'idle' });
  const currentVersionNumber =
    state.phase === 'ready' && state.article.id === id ? state.article.currentVersionNumber : null;

  useEffect(() => {
    let active = true;
    fetchArticle(id).then(
      (article) => {
        if (active) {
          setState({ phase: 'ready', article });
        }
      },
      (cause: unknown) => {
        if (active) {
          setState({ phase: 'error', message: errorMessage(cause) });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [id]);

  // Текущую версию грузим отдельно: карточка материала приходит без текста статьи.
  useEffect(() => {
    if (currentVersionNumber === null) {
      setVersionState({ phase: 'idle' });
      return;
    }
    let active = true;
    setVersionState({ phase: 'loading' });
    fetchVersion(id, currentVersionNumber).then(
      (version) => {
        if (active) {
          setVersionState({ phase: 'ready', version });
        }
      },
      (cause: unknown) => {
        if (active) {
          setVersionState({ phase: 'error', message: errorMessage(cause) });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [id, currentVersionNumber]);

  if (state.phase === 'loading') {
    return <Notice>Загружаем материал…</Notice>;
  }
  if (state.phase === 'error') {
    return <Notice tone="error">{state.message}</Notice>;
  }

  const article = state.article;
  const user = session.phase === 'authenticated' ? session.user : undefined;
  const isOwnerOrAdmin =
    user !== undefined && (user.id === article.owner.id || user.role === 'admin');
  const canEdit = isOwnerOrAdmin && article.status !== 'archived' && article.status !== 'published';
  const canChangeFacts = isOwnerOrAdmin && CONTENT_EDITABLE_STATUSES.includes(article.status);
  // Подтверждение вне фокуса ИИ даёт ревьюер, и только если он не автор материала.
  const canConfirmGeneration =
    user !== undefined &&
    (user.role === 'reviewer' || user.role === 'admin') &&
    (user.id !== article.owner.id || user.role === 'admin');
  const style = catalog.styles.find((item) => item.id === article.styleId);
  const replace = (next: ArticleDetail) => setState({ phase: 'ready', article: next });

  return (
    <div className="flex flex-col gap-8">
      <Link to="/" className={`w-fit text-sm font-medium hover:underline ${FOCUS_RING}`}>
        ← К доске
      </Link>
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium text-on-surface-variant">
          Статус: {ARTICLE_STATUS_LABELS[article.status]}
        </p>
        <h1 className="font-display text-3xl font-bold leading-tight">{article.topic}</h1>
        <p className="text-on-surface-variant">
          {article.styleName} · {ARTICLE_FORMAT_LABELS[article.format]} ·{' '}
          {TONE_LABELS[article.tone]} · {article.lengthMin}–{article.lengthMax} знаков
        </p>
        <p className="text-sm text-on-surface-variant">
          Автор: {article.owner.name ?? article.owner.login}
          {article.reviewer ? `, ревьюер: ${article.reviewer.login}` : ''}
          {article.plannedAt ? `, плановая дата: ${formatDate(article.plannedAt)}` : ''}, версия{' '}
          {article.version}
        </p>
        <div className="mt-1 flex flex-wrap gap-4 text-sm font-medium">
          {article.currentVersionNumber !== null ? (
            <a href="#article-text" className={`w-fit hover:underline ${FOCUS_RING}`}>
              Читать текст
            </a>
          ) : null}
          {canEdit ? (
            <Link
              to={`/articles/${article.id}/edit`}
              className={`w-fit hover:underline ${FOCUS_RING}`}
            >
              Редактировать текст
            </Link>
          ) : null}
        </div>
      </header>

      <Suspense fallback={<Notice>Загружаем текст материала…</Notice>}>
        <ArticleTextView
          article={article}
          version={versionState.phase === 'ready' ? versionState.version : null}
          loading={versionState.phase === 'loading'}
          error={versionState.phase === 'error' ? versionState.message : null}
        />
      </Suspense>

      <div className="grid gap-6 lg:grid-cols-2">
        <RequirementsPanel article={article} />
        <TransitionForm article={article} onDone={replace} />
      </div>

      <GenerationPanel
        article={article}
        canRun={isOwnerOrAdmin}
        canConfirm={canConfirmGeneration}
        onChanged={replace}
      />

      {canEdit ? <ArticleEditForm article={article} onSaved={replace} /> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <VersionsPanel article={article} />
        <ArticleFactsPanel
          article={article}
          style={style}
          canEdit={canChangeFacts}
          onChanged={replace}
        />
      </div>

      <ChecksPanel article={article} canConfirm={isOwnerOrAdmin} onChanged={replace} />

      <div className="grid gap-6 lg:grid-cols-2">
        <ReviewsPanel article={article} />
        <PublicationsPanel article={article} />
      </div>
    </div>
  );
}

function RequirementsPanel({ article }: { readonly article: ArticleDetail }) {
  return (
    <section aria-labelledby="requirements-title" className={PANEL_CLASS}>
      <h2 id="requirements-title" className="font-display text-lg font-bold">
        Условия стиля
      </h2>
      {article.requirements.length === 0 ? (
        <p className="mt-3 text-sm text-on-surface-variant">
          Для этого стиля отдельных условий нет.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {article.requirements.map((item) => (
            <li key={item.title} className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{item.title}</span>
              <span className="text-on-surface-variant">
                {item.actual} из {item.required} — {item.met ? 'выполнено' : 'не выполнено'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function VersionsPanel({ article }: { readonly article: ArticleDetail }) {
  return (
    <section aria-labelledby="versions-title" className={PANEL_CLASS}>
      <h2 id="versions-title" className="font-display text-lg font-bold">
        Версии
      </h2>
      {article.versions.length === 0 ? (
        <p className="mt-3 text-sm text-on-surface-variant">Версий пока нет.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3 text-sm">
          {article.versions.map((version) => (
            <li key={version.number}>
              Версия {version.number}: {ORIGIN_LABELS[version.origin] ?? version.origin},{' '}
              {version.createdBy}, {formatDateTime(version.createdAt)}. Блокирующих проверок:{' '}
              {version.blockingChecks}
              {version.advertisingLabel ? ', маркировка рекламы есть' : ''}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ReviewsPanel({ article }: { readonly article: ArticleDetail }) {
  return (
    <section aria-labelledby="reviews-title" className={PANEL_CLASS}>
      <h2 id="reviews-title" className="font-display text-lg font-bold">
        Решения ревьюера
      </h2>
      {article.reviews.length === 0 ? (
        <p className="mt-3 text-sm text-on-surface-variant">Решений пока нет.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3 text-sm">
          {article.reviews.map((review) => (
            <li key={`${review.createdAt}-${review.decision}`}>
              {REVIEW_LABELS[review.decision] ?? review.decision}, версия {review.versionNumber},{' '}
              {review.reviewerLogin}, {formatDateTime(review.createdAt)}
              {review.comment ? `. Комментарий: ${review.comment}` : ''}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PublicationsPanel({ article }: { readonly article: ArticleDetail }) {
  const canExport =
    article.status === 'approved' ||
    article.status === 'scheduled' ||
    article.status === 'published';
  return (
    <section aria-labelledby="publications-title" className={PANEL_CLASS}>
      <h2 id="publications-title" className="font-display text-lg font-bold">
        Публикация
      </h2>
      {article.publications.length === 0 ? (
        <p className="mt-3 text-sm text-on-surface-variant">Публикаций пока нет.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3 text-sm">
          {article.publications.map((publication, index) => (
            <li key={index}>
              {PUBLICATION_LABELS[publication.status] ?? publication.status} в Дзене
              {publication.publishedAt ? `, ${formatDate(publication.publishedAt)}` : ''}
              {publication.externalUrl ? (
                <>
                  {' · '}
                  <a href={publication.externalUrl} rel="noopener noreferrer" className="underline">
                    ссылка на статью
                  </a>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canExport ? (
        <div className="mt-4">
          <a href={exportUrl(article.id)} className={BUTTON_SECONDARY} download>
            Скачать пакет для Дзена
          </a>
        </div>
      ) : (
        <p className="mt-4 text-sm text-on-surface-variant">
          Пакет готовится после утверждения материала.
        </p>
      )}
    </section>
  );
}
