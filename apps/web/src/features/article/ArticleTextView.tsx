import {
  CLAIM_TYPE_LABELS,
  FACT_STATUS_LABELS,
  VERSION_ORIGIN_LABELS,
  type ArticleDetail,
  type VersionClaim,
  type VersionDetail,
} from '@dzenwriter/shared';
import { ArticlePreview } from '../editor/ArticlePreview';
import { formatDateTime } from '../../lib/format';
import { FOCUS_RING, PANEL_CLASS } from '../../shared/ui/classes';
import { Notice } from '../../shared/ui/Notice';

interface ArticleTextViewProps {
  readonly article: ArticleDetail;
  readonly version: VersionDetail | null;
  readonly loading: boolean;
  readonly error: string | null;
}

type ArticleFact = ArticleDetail['facts'][number];

// Read-only просмотр текущей версии для автора и ревьюера: текст, утверждения и их факты.
// Редактор остаётся отдельным экраном и доступен только владельцу или администратору.
export function ArticleTextView({ article, version, loading, error }: ArticleTextViewProps) {
  return (
    <section
      id="article-text"
      aria-labelledby="article-text-title"
      className={`${PANEL_CLASS} scroll-mt-6`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="article-text-title" className="font-display text-lg font-bold">
          Текст материала
        </h2>
        {version ? (
          <p className="text-sm text-on-surface-variant">
            Версия {version.number} · {VERSION_ORIGIN_LABELS[version.origin]} ·{' '}
            {formatDateTime(version.createdAt)}
          </p>
        ) : null}
      </div>
      <p className="mt-2 text-sm text-on-surface-variant">
        Текущая версия в режиме чтения. Непроверенные фрагменты подчёркнуты — так же, как их увидит
        автор в редакторе.
      </p>

      {loading ? (
        <div className="mt-4">
          <Notice>Загружаем текст текущей версии…</Notice>
        </div>
      ) : null}
      {error ? (
        <div className="mt-4">
          <Notice tone="error">Не удалось загрузить текст: {error}</Notice>
        </div>
      ) : null}
      {!loading && !error && version === null ? (
        <p className="mt-4 text-sm text-on-surface-variant">
          Текст появится после генерации или сохранения версии.
        </p>
      ) : null}
      {!loading && !error && version !== null ? (
        <>
          <div className="mt-4">
            <ArticlePreview
              title={version.title}
              markdown={version.articleMarkdown}
              checks={article.checks}
              full
            />
          </div>
          <ClaimsSummary claims={version.claims} facts={article.facts} />
          <ArticleMetadata version={version} />
        </>
      ) : null}
    </section>
  );
}

function ClaimsSummary({
  claims,
  facts,
}: {
  readonly claims: readonly VersionClaim[];
  readonly facts: readonly ArticleFact[];
}) {
  if (claims.length === 0) {
    return (
      <div className="mt-6 border-t border-outline-variant pt-4">
        <h3 className="font-display text-base font-bold">Утверждения</h3>
        <p className="mt-2 text-sm text-on-surface-variant">
          В этой версии нет утверждений. Проверьте текст вручную.
        </p>
      </div>
    );
  }

  const factsByLabel = new Map(facts.map((fact) => [fact.label, fact]));

  return (
    <div className="mt-6 border-t border-outline-variant pt-4">
      <h3 className="font-display text-base font-bold">Утверждения</h3>
      <p className="mt-2 text-sm text-on-surface-variant">
        Тип утверждения и привязка к фактам — то, что проверяет ревьюер.
      </p>
      <ul className="mt-3 flex flex-col gap-3">
        {claims.map((claim, index) => {
          const linked = claim.factIds.map((label) => ({ label, fact: factsByLabel.get(label) }));
          return (
            <li
              key={`${claim.text}-${index}`}
              className="rounded-xl border border-outline-variant p-3 text-sm"
            >
              <p className="font-medium">{claim.text}</p>
              <p className="mt-1 text-on-surface-variant">
                {CLAIM_TYPE_LABELS[claim.type]}
                {claim.factIds.length > 0
                  ? ` · ${claim.factIds.join(', ')}`
                  : claim.type === 'fact'
                    ? ' · без факта'
                    : ' · факт не требуется'}
              </p>
              {claim.type === 'fact' && claim.factIds.length === 0 ? (
                <p className="mt-2 text-error">
                  Блокирующее: утверждение о факте без ссылки на факт.
                </p>
              ) : null}
              {linked.length > 0 ? (
                <div className="mt-2 flex flex-col gap-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">
                    Факты
                  </p>
                  {linked.map(({ label, fact }) => (
                    <p key={label} className="text-on-surface-variant">
                      <span className="font-medium text-on-surface">{label}</span>
                      {fact
                        ? ` · ${FACT_STATUS_LABELS[fact.status]}: ${fact.text}`
                        : ' · факт не привязан к материалу'}
                    </p>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ArticleMetadata({ version }: { readonly version: VersionDetail }) {
  return (
    <details className="mt-6 border-t border-outline-variant pt-4 text-sm">
      <summary className={`w-fit cursor-pointer font-medium ${FOCUS_RING}`}>
        Метаданные публикации
      </summary>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        <MetaRow label="SEO-заголовок" value={version.seoTitle} />
        <MetaRow label="Теги" value={version.tags.join(', ')} />
        <MetaRow label="Описание" value={version.description} />
        <MetaRow label="Промпт обложки" value={version.imagePrompt} />
        <MetaRow label="Маркировка рекламы" value={version.advertisingLabel ? 'есть' : 'нет'} />
        <MetaRow label="Оговорка" value={version.disclaimerText ?? ''} />
        <MetaRow label="Версия стиля" value={String(version.styleVersion)} />
      </dl>
    </details>
  );
}

function MetaRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="font-medium">{label}</dt>
      <dd className="whitespace-pre-line text-on-surface-variant">{value || '—'}</dd>
    </div>
  );
}
