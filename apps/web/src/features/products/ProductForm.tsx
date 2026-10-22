import {
  createProductInputSchema,
  updateProductInputSchema,
  type Product,
} from '@dzenwriter/shared';
import { type FormEvent, useState } from 'react';
import { errorMessage } from '../../api/client';
import { createProduct, updateProduct } from '../../api/products';
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  INPUT_CLASS,
  LABEL_CLASS,
} from '../../shared/ui/classes';
import { Notice } from '../../shared/ui/Notice';

interface ProductFormProps {
  readonly initial?: Product;
  readonly onSaved: (product: Product) => void;
  readonly onCancel: () => void;
}

// Продукт создаёт и правит администратор. Архивирование — отдельной кнопкой в списке.
export function ProductForm({ initial, onSaved, onCancel }: ProductFormProps) {
  const [slug, setSlug] = useState(initial?.slug ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [oneLiner, setOneLiner] = useState(initial?.oneLiner ?? '');
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = { slug: slug.trim(), name: name.trim(), oneLiner: oneLiner.trim() };
    const parsed = initial
      ? updateProductInputSchema.safeParse(input)
      : createProductInputSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Проверьте поля продукта');
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      onSaved(initial ? await updateProduct(initial.id, input) : await createProduct(input));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      noValidate
      className="grid gap-4 md:grid-cols-2"
    >
      <label className={LABEL_CLASS}>
        Идентификатор (латиница, дефисы)
        <input
          className={INPUT_CLASS}
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
        />
      </label>
      <label className={LABEL_CLASS}>
        Название
        <input
          className={INPUT_CLASS}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className={`${LABEL_CLASS} md:col-span-2`}>
        Описание в одну строку
        <input
          className={INPUT_CLASS}
          value={oneLiner}
          onChange={(event) => setOneLiner(event.target.value)}
        />
      </label>
      {error ? (
        <div className="md:col-span-2">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3 md:col-span-2">
        <button type="submit" className={BUTTON_PRIMARY} disabled={busy}>
          {initial ? 'Сохранить продукт' : 'Добавить продукт'}
        </button>
        <button type="button" className={BUTTON_SECONDARY} onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  );
}
