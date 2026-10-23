import {
  FACT_TYPES,
  FACT_TYPES_BY_POLICY,
  type ArticleDetail,
  type FactItem,
  type Product,
  type StyleCard,
} from '@dzenwriter/shared';
import { FactForm } from '../facts/FactForm';

interface AddFactDialogProps {
  readonly article: ArticleDetail;
  readonly question: string;
  readonly style: StyleCard | undefined;
  readonly products: readonly Product[];
  readonly onSaved: (fact: FactItem) => void;
  readonly onCancel: () => void;
}

// Создание факта из вопроса модели: тип ограничен политикой стиля материала.
export function AddFactDialog({
  article,
  question,
  style,
  products,
  onSaved,
  onCancel,
}: AddFactDialogProps) {
  const allowedTypes = style ? FACT_TYPES_BY_POLICY[style.factPolicy] : FACT_TYPES;
  const defaultType = allowedTypes[0] ?? 'company_fact';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-fact-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl border border-outline-variant bg-surface p-6 shadow-xl">
        <h2 id="add-fact-title" className="font-display text-xl font-bold">
          Добавить факт
        </h2>
        <p className="mt-2 rounded-lg bg-surface-container px-3 py-2 text-sm">
          Вопрос модели: «{question}»
        </p>
        <p className="mt-2 text-sm text-on-surface-variant">
          Факт создастся как черновик и сразу привяжется к материалу. Чтобы он попал в следующую
          генерацию, его должен одобрить ревьюер.
        </p>
        <div className="mt-5">
          <FactForm
            mode="create"
            products={products}
            allowedTypes={allowedTypes}
            defaultType={defaultType}
            defaultProductId={article.productId ?? undefined}
            onSaved={onSaved}
            onCancel={onCancel}
          />
        </div>
      </div>
    </div>
  );
}
