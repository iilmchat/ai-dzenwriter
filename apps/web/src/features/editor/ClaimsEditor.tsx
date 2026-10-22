import { CLAIM_TYPE_LABELS, type ClaimType } from '@dzenwriter/shared';
import { INPUT_CLASS, LABEL_CLASS, PANEL_CLASS } from '../../shared/ui/classes';

export interface ClaimDraft {
  readonly text: string;
  readonly type: ClaimType;
  readonly factIds: readonly string[];
}

export interface ClaimFactOption {
  readonly label: string;
  readonly text: string;
  readonly status: string;
}

export interface ClaimsEditorProps {
  readonly claims: readonly ClaimDraft[];
  readonly facts: readonly ClaimFactOption[];
  readonly onChange: (claims: readonly ClaimDraft[]) => void;
}

// Утверждения материала: автор видит, что текст ссылается на факты, и может
// перепривязать утверждение к другому факту.
export function ClaimsEditor({ claims, facts, onChange }: ClaimsEditorProps) {
  if (claims.length === 0) {
    return null;
  }

  function toggle(claimIndex: number, label: string) {
    onChange(
      claims.map((claim, index) => {
        if (index !== claimIndex) {
          return claim;
        }
        const has = claim.factIds.includes(label);
        return {
          ...claim,
          factIds: has ? claim.factIds.filter((id) => id !== label) : [...claim.factIds, label],
        };
      }),
    );
  }

  return (
    <div className={PANEL_CLASS}>
      <h2 className="font-display text-lg font-bold">Утверждения</h2>
      <p className="mt-2 text-sm text-on-surface-variant">
        Утверждение о факте должно ссылаться на факт из материала. Без ссылки сработает блокирующая
        проверка.
      </p>
      <ul className="mt-3 flex flex-col gap-3">
        {claims.map((claim, index) => (
          <li
            key={`${claim.text}-${index}`}
            className="rounded-xl border border-outline-variant p-3"
          >
            <p className="text-sm font-medium">{claim.text}</p>
            <p className="text-xs text-on-surface-variant">
              {CLAIM_TYPE_LABELS[claim.type]}
              {claim.factIds.length === 0 ? ' · без факта' : ` · ${claim.factIds.join(', ')}`}
            </p>
            <div className="mt-2 flex flex-col gap-1">
              {facts.map((fact) => (
                <label key={fact.label} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={claim.factIds.includes(fact.label)}
                    onChange={() => toggle(index, fact.label)}
                  />
                  <span>
                    <span className="font-medium">{fact.label}</span>
                    <span className="block text-on-surface-variant">{fact.text}</span>
                  </span>
                </label>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface EditorMetadataProps {
  readonly seoTitle: string;
  readonly tags: readonly string[];
  readonly description: string;
  readonly imagePrompt: string;
  readonly seoTitleMax: number;
  readonly onChange: (fields: {
    readonly seoTitle: string;
    readonly tags: readonly string[];
    readonly description: string;
    readonly imagePrompt: string;
  }) => void;
}

// Метаданные под редактором: SEO-заголовок, теги, описание и промпт обложки.
export function EditorMetadata({
  seoTitle,
  tags,
  description,
  imagePrompt,
  seoTitleMax,
  onChange,
}: EditorMetadataProps) {
  return (
    <div className={PANEL_CLASS}>
      <h2 className="font-display text-lg font-bold">Метаданные</h2>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div className={LABEL_CLASS}>
          <label htmlFor="seo-title">SEO-заголовок</label>
          <input
            id="seo-title"
            className={INPUT_CLASS}
            value={seoTitle}
            maxLength={300}
            onChange={(event) =>
              onChange({ seoTitle: event.target.value, tags, description, imagePrompt })
            }
          />
          <span className="text-xs text-on-surface-variant">
            {seoTitle.length} из {seoTitleMax}
          </span>
        </div>
        <div className={LABEL_CLASS}>
          <label htmlFor="tags">Теги</label>
          <input
            id="tags"
            className={INPUT_CLASS}
            value={tags.join(', ')}
            placeholder="через запятую"
            onChange={(event) =>
              onChange({
                seoTitle,
                tags: event.target.value
                  .split(',')
                  .map((tag) => tag.trim())
                  .filter((tag) => tag.length > 0),
                description,
                imagePrompt,
              })
            }
          />
          <span className="text-xs text-on-surface-variant">Тегов: {tags.length}</span>
        </div>
        <div className={LABEL_CLASS}>
          <label htmlFor="description">Описание</label>
          <textarea
            id="description"
            className={INPUT_CLASS}
            rows={2}
            value={description}
            maxLength={1000}
            onChange={(event) =>
              onChange({ seoTitle, tags, description: event.target.value, imagePrompt })
            }
          />
        </div>
        <div className={LABEL_CLASS}>
          <label htmlFor="image-prompt">IMAGE_PROMPT</label>
          <textarea
            id="image-prompt"
            className={INPUT_CLASS}
            rows={2}
            value={imagePrompt}
            maxLength={1000}
            onChange={(event) =>
              onChange({ seoTitle, tags, description, imagePrompt: event.target.value })
            }
          />
        </div>
      </div>
    </div>
  );
}
