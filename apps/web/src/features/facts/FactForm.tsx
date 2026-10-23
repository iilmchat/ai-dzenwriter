import {
  createFactInputSchema,
  factContentSchema,
  FACT_TYPE_LABELS,
  FACT_TYPES,
  updateFactInputSchema,
  type FactFields,
  type FactItem,
  type FactType,
  type Product,
} from '@dzenwriter/shared';
import { type FormEvent, useState } from 'react';
import { errorMessage } from '../../api/client';
import { correctFact, createFact, updateFact } from '../../api/facts';
import { capitalize, parseOption } from '../../lib/format';
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  INPUT_CLASS,
  LABEL_CLASS,
} from '../../shared/ui/classes';
import { Notice } from '../../shared/ui/Notice';

export type FactFormMode = 'create' | 'edit' | 'correction';

interface FactFormProps {
  readonly mode: FactFormMode;
  readonly products: readonly Product[];
  readonly initial?: FactItem;
  // Для создания из материала: типы, которые допускает политика стиля.
  readonly allowedTypes?: readonly FactType[];
  readonly defaultType?: FactType;
  readonly defaultProductId?: string;
  readonly onSaved: (fact: FactItem) => void;
  readonly onCancel: () => void;
}

interface Values {
  readonly type: FactType;
  readonly text: string;
  readonly sourceName: string;
  readonly sourceUrl: string;
  readonly sourcePublishedAt: string;
  readonly productId: string;
  readonly mentionsClient: boolean;
  readonly clientPermission: boolean;
}

const SUBMIT_LABEL: Record<FactFormMode, string> = {
  create: 'Сохранить факт',
  edit: 'Сохранить правку',
  correction: 'Создать исправление',
};

// Создание, правка и исправление одной формой. Проверка — теми же схемами, что на сервере.
export function FactForm({
  mode,
  products,
  initial,
  allowedTypes,
  defaultType,
  defaultProductId,
  onSaved,
  onCancel,
}: FactFormProps) {
  const typeOptions =
    allowedTypes !== undefined && allowedTypes.length > 0 ? allowedTypes : FACT_TYPES;
  const initialType =
    defaultType !== undefined && typeOptions.includes(defaultType)
      ? defaultType
      : (typeOptions[0] ?? 'company_fact');
  const [values, setValues] = useState<Values>(() =>
    initialValues(initial, initialType, defaultProductId),
  );
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const isNews = values.type === 'news_source';
  const hasSource = values.type !== 'experience_note';

  function update<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = toFields(values);
    const problem = validate(mode, values.type, fields, initial);
    if (problem) {
      setError(problem);
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      onSaved(await send(mode, values.type, fields, initial));
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
      {mode === 'create' ? (
        <label className={LABEL_CLASS}>
          Тип факта
          <select
            className={INPUT_CLASS}
            value={values.type}
            onChange={(event) =>
              update('type', parseOption(typeOptions, event.target.value) || initialType)
            }
          >
            {typeOptions.map((type) => (
              <option key={type} value={type}>
                {capitalize(FACT_TYPE_LABELS[type])}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="text-sm font-medium md:col-span-2">
          Тип: {capitalize(FACT_TYPE_LABELS[values.type])}
        </p>
      )}

      <label className={`${LABEL_CLASS} md:col-span-2`}>
        {values.type === 'experience_note'
          ? 'Текст заметки, имена заменены ролями'
          : 'Текст факта или цитаты'}
        <textarea
          className={INPUT_CLASS}
          rows={4}
          value={values.text}
          onChange={(event) => update('text', event.target.value)}
        />
      </label>

      {hasSource ? (
        <>
          <label className={LABEL_CLASS}>
            Название источника
            <input
              className={INPUT_CLASS}
              value={values.sourceName}
              onChange={(event) => update('sourceName', event.target.value)}
            />
          </label>
          <label className={LABEL_CLASS}>
            Ссылка на источник{isNews ? ' (обязательна)' : ''}
            <input
              type="url"
              className={INPUT_CLASS}
              placeholder="https://"
              value={values.sourceUrl}
              onChange={(event) => update('sourceUrl', event.target.value)}
            />
          </label>
          <label className={LABEL_CLASS}>
            Дата публикации источника{isNews ? ' (обязательна)' : ''}
            <input
              type="date"
              className={INPUT_CLASS}
              value={values.sourcePublishedAt}
              onChange={(event) => update('sourcePublishedAt', event.target.value)}
            />
          </label>
        </>
      ) : null}

      {values.type === 'product_fact' ? (
        <label className={`${LABEL_CLASS} md:col-span-2`}>
          Продукт
          <select
            className={INPUT_CLASS}
            value={values.productId}
            onChange={(event) => update('productId', event.target.value)}
          >
            <option value="">Выберите продукт</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {values.type === 'company_fact' || values.type === 'product_fact' ? (
        <fieldset className="flex flex-col gap-2 text-sm md:col-span-2">
          <legend className="font-medium">Клиенты</legend>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={values.mentionsClient}
              onChange={(event) => update('mentionsClient', event.target.checked)}
            />
            В тексте назван клиент
          </label>
          {values.mentionsClient ? (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={values.clientPermission}
                onChange={(event) => update('clientPermission', event.target.checked)}
              />
              Клиент разрешил назвать себя. Без разрешения факт не одобряется
            </label>
          ) : null}
        </fieldset>
      ) : null}

      {values.type === 'experience_note' ? (
        <p className="text-sm text-on-surface-variant md:col-span-2">
          Заметку одобряют только после подтверждения согласия и обезличивания ревьюером.
        </p>
      ) : null}

      {error ? (
        <div className="md:col-span-2">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3 md:col-span-2">
        <button type="submit" className={BUTTON_PRIMARY} disabled={busy}>
          {SUBMIT_LABEL[mode]}
        </button>
        <button type="button" className={BUTTON_SECONDARY} onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  );
}

function initialValues(
  fact: FactItem | undefined,
  initialType: FactType,
  defaultProductId: string | undefined,
): Values {
  return {
    type: fact?.type ?? initialType,
    text: fact?.text ?? '',
    sourceName: fact?.sourceName ?? '',
    sourceUrl: fact?.sourceUrl ?? '',
    sourcePublishedAt: fact?.sourcePublishedAt ?? '',
    productId: fact?.productId ?? defaultProductId ?? '',
    mentionsClient: fact?.mentionsClient ?? false,
    clientPermission: fact?.clientPermission ?? false,
  };
}

function toFields(values: Values): FactFields {
  return {
    text: values.text.trim(),
    sourceName: emptyToNull(values.sourceName),
    sourceUrl: emptyToNull(values.sourceUrl),
    sourcePublishedAt: emptyToNull(values.sourcePublishedAt),
    productId: values.type === 'product_fact' ? emptyToNull(values.productId) : null,
    mentionsClient: values.mentionsClient,
    clientPermission: values.mentionsClient && values.clientPermission,
  };
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function validate(
  mode: FactFormMode,
  type: FactType,
  fields: FactFields,
  initial: FactItem | undefined,
): string | undefined {
  const result =
    mode === 'create'
      ? createFactInputSchema.safeParse({ type, ...fields })
      : mode === 'edit'
        ? updateFactInputSchema.safeParse({ expectedVersion: initial?.version ?? 1, ...fields })
        : factContentSchema(type).safeParse(fields);
  return result.success ? undefined : (result.error.issues[0]?.message ?? 'Проверьте поля факта');
}

function send(
  mode: FactFormMode,
  type: FactType,
  fields: FactFields,
  initial: FactItem | undefined,
): Promise<FactItem> {
  if (mode === 'create') {
    return createFact({ type, ...fields });
  }
  if (!initial) {
    throw new Error('Не выбран факт для изменения');
  }
  if (mode === 'edit') {
    return updateFact(initial.id, { expectedVersion: initial.version, ...fields });
  }
  return correctFact(initial.id, fields);
}
