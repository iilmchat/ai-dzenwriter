import { ARTICLE_FORMAT_LABELS, ARTICLE_STATUS_LABELS, type ArticleItem } from '@dzenwriter/shared';
import { Link } from 'react-router';
import { formatDate } from '../../lib/format';
import { FOCUS_RING } from '../../shared/ui/classes';

export function ArticleCard({ article }: { readonly article: ArticleItem }) {
  return (
    <li className="rounded-xl border border-outline-variant bg-surface p-4">
      <Link
        to={`/articles/${article.id}`}
        className={`font-medium leading-snug hover:underline ${FOCUS_RING}`}
      >
        {article.topic}
      </Link>
      <p className="mt-2 text-sm text-on-surface-variant">
        {article.styleName}, {ARTICLE_FORMAT_LABELS[article.format]}
      </p>
      <p className="text-sm text-on-surface-variant">
        Автор: {article.owner.name ?? article.owner.login}
      </p>
      {article.plannedAt ? (
        <p className="text-sm text-on-surface-variant">
          Плановая дата: {formatDate(article.plannedAt)}
        </p>
      ) : null}
      <p className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-secondary-container px-2.5 py-1 font-medium text-on-secondary-container">
          {ARTICLE_STATUS_LABELS[article.status]}
        </span>
        {article.currentVersionNumber !== null ? (
          <span>версия {article.currentVersionNumber}</span>
        ) : null}
        {article.reviewer ? <span>ревьюер: {article.reviewer.login}</span> : null}
      </p>
    </li>
  );
}
