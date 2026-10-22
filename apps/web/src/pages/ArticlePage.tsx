import {
  ARTICLE_FORMAT_LABELS,
  ARTICLE_STATUS_LABELS,
  FACT_TYPE_LABELS,
  TONE_LABELS,
  type ArticleDetail,
} from '@dzenwriter/shared';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { fetchArticle } from '../api/articles';
import { errorMessage } from '../api/client';
import { ArticleEditForm } from '../features/article/ArticleEditForm';
import { TransitionForm } from '../features/article/TransitionForm';
import { formatDate, formatDateTime } from '../lib/format';
import { useSession } from '../session/SessionContext';
import { FOCUS_RING, PANEL_CLASS } from '../shared/ui/classes';
import { Notice } from '../shared/ui/Notice';

type ArticleState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly article: ArticleDetail }
  | { readonly phase: 'error'; readonly message: string };

const ORIGIN_LABELS: Record<string, string> = { generated: 'генерация', manual: 'ручная правка' };
const FACT_STATUS_LABELS: Record<string, string> = {
  draft: 'черновик',
  approved: 'одобрен',
  rejected: 'отклонён',
  superseded: 'заменён',
};
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
  const [state, setState] = useState<ArticleState>({ phase: 'loading' });

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

  if (state.phase === 'loading') {
    return <Notice>Загружаем материал…</Notice>;
  }
  if (state.phase === 'error') {
    return <Notice tone="error">{state.message}</Notice>;
  }

  const article = state.article;
  const user = session.phase === 'authenticated' ? session.user : undefined;
  const canEdit =
    user !== undefined &&
    (user.id === article.owner.id || user.role === 'admin') &&
    article.status !== 'archived' &&
    article.status !== 'published';
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
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <RequirementsPanel article={article} />
        <TransitionForm article={article} onDone={replace} />
      </div>

      {canEdit ? <ArticleEditForm article={article} onSaved={replace} /> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <VersionsPanel article={article} />
        <FactsPanel article={article} />
      </div>

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

function FactsPanel({ article }: { readonly article: ArticleDetail }) {
  return (
    <section aria-labelledby="facts-title" className={PANEL_CLASS}>
      <h2 id="facts-title" className="font-display text-lg font-bold">
        Факты материала
      </h2>
      {article.facts.length === 0 ? (
        <p className="mt-3 text-sm text-on-surface-variant">
          Факты ещё не привязаны. Факт-база появится в следующем этапе.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3 text-sm">
          {article.facts.map((fact) => (
            <li key={fact.label}>
              {fact.label} · {FACT_TYPE_LABELS[fact.type]} ·{' '}
              {FACT_STATUS_LABELS[fact.status] ?? fact.status}
              {fact.sourceName ? ` · ${fact.sourceName}` : ''}
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
    </section>
  );
}
