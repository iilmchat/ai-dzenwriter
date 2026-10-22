import {
  TONE_LABELS,
  createArticleInputSchema,
  type CreateArticleResponse,
  type FormatCard,
  type Product,
  type StyleCard,
} from '@dzenwriter/shared';
import { type FormEvent, useState } from 'react';
import { createArticle } from '../../api/articles';
import { ApiError, errorMessage } from '../../api/client';
import { dateToPlannedAt, parseKeywords } from '../../lib/format';
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  INPUT_CLASS,
  LABEL_CLASS,
} from '../../shared/ui/classes';
import { Notice } from '../../shared/ui/Notice';
import { ARTICLE_FORMAT_LABELS } from '@dzenwriter/shared';

interface CreateArticleFormProps {
  readonly styles: readonly StyleCard[];
  readonly formats: readonly FormatCard[];
  readonly products: readonly Product[];
  readonly onCreated: (response: CreateArticleResponse) => void;
  readonly onCancel: () => void;
}

// Форма создания: значения по умолчанию берутся из стиля и формата, проверка — той же схемой, что на сервере.
export function CreateArticleForm({
  styles,
  formats,
  products,
  onCreated,
  onCancel,
}: CreateArticleFormProps) {
  const [topic, setTopic] = useState('');
  const [keywords, setKeywords] = useState('');
  const [styleId, setStyleId] = useState('');
  const [format, setFormat] = useState('');
  const [tone, setTone] = useState('');
  const [productId, setProductId] = useState('');
  const [lengthMin, setLengthMin] = useState('');
  const [lengthMax, setLengthMax] = useState('');
  const [plannedDate, setPlannedDate] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const style = styles.find((item) => item.id === (styleId || styles[0]?.id));
  const allowedFormats = style?.allowedFormats ?? [];
  const effectiveFormat = allowedFormats.find((item) => item === format) ?? allowedFormats[0] ?? '';
  const formatCard = formats.find((item) => item.id === effectiveFormat);
  const needsProduct = style?.inputs.requiresProduct === true;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = createArticleInputSchema.safeParse({
      topic,
      keywords: parseKeywords(keywords),
      styleId: style?.id ?? '',
      format: effectiveFormat,
      tone: tone || style?.defaultTone,
      productId: needsProduct && productId ? productId : undefined,
      lengthMin: lengthMin ? Number(lengthMin) : undefined,
      lengthMax: lengthMax ? Number(lengthMax) : undefined,
      plannedAt: dateToPlannedAt(plannedDate),
    });
    if (!parsed.success) {
      setErrors(collectErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    setServerError(undefined);
    setBusy(true);
    try {
      const response = await createArticle(parsed.data);
      setTopic('');
      setKeywords('');
      setPlannedDate('');
      onCreated(response);
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : errorMessage(error));
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
      <label className={`${LABEL_CLASS} md:col-span-2`}>
        Тема или инфоповод
        <input
          className={INPUT_CLASS}
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          aria-invalid={errors.topic !== undefined}
          aria-describedby={errors.topic ? 'topic-error' : undefined}
        />
        {errors.topic ? (
          <span id="topic-error" className="text-sm text-error">
            {errors.topic}
          </span>
        ) : null}
      </label>
      <label className={LABEL_CLASS}>
        Ключевые слова через запятую
        <input
          className={INPUT_CLASS}
          value={keywords}
          onChange={(event) => setKeywords(event.target.value)}
        />
        {errors.keywords ? <span className="text-sm text-error">{errors.keywords}</span> : null}
      </label>
      <label className={LABEL_CLASS}>
        Стиль
        <select
          className={INPUT_CLASS}
          value={style?.id ?? ''}
          onChange={(event) => setStyleId(event.target.value)}
        >
          {styles.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        {errors.styleId ? <span className="text-sm text-error">{errors.styleId}</span> : null}
      </label>
      <label className={LABEL_CLASS}>
        Формат
        <select
          className={INPUT_CLASS}
          value={effectiveFormat}
          onChange={(event) => setFormat(event.target.value)}
        >
          {allowedFormats.map((item) => (
            <option key={item} value={item}>
              {ARTICLE_FORMAT_LABELS[item]}
            </option>
          ))}
        </select>
        {errors.format ? <span className="text-sm text-error">{errors.format}</span> : null}
      </label>
      <label className={LABEL_CLASS}>
        Тон
        <select
          className={INPUT_CLASS}
          value={tone || style?.defaultTone || ''}
          onChange={(event) => setTone(event.target.value)}
        >
          {Object.entries(TONE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {needsProduct ? (
        <label className={`${LABEL_CLASS} md:col-span-2`}>
          Продукт
          <select
            className={INPUT_CLASS}
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
          >
            <option value="">Выберите продукт</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
          {errors.productId ? <span className="text-sm text-error">{errors.productId}</span> : null}
        </label>
      ) : null}
      <label className={LABEL_CLASS}>
        Объём, знаков: от
        <input
          type="number"
          min={1}
          className={INPUT_CLASS}
          placeholder={formatCard ? String(formatCard.length.min) : ''}
          value={lengthMin}
          onChange={(event) => setLengthMin(event.target.value)}
        />
      </label>
      <label className={LABEL_CLASS}>
        Объём, знаков: до
        <input
          type="number"
          min={1}
          className={INPUT_CLASS}
          placeholder={formatCard ? String(formatCard.length.max) : ''}
          value={lengthMax}
          onChange={(event) => setLengthMax(event.target.value)}
        />
        {errors.lengthMin ? <span className="text-sm text-error">{errors.lengthMin}</span> : null}
      </label>
      <label className={LABEL_CLASS}>
        Плановая дата публикации
        <input
          type="date"
          className={INPUT_CLASS}
          value={plannedDate}
          onChange={(event) => setPlannedDate(event.target.value)}
        />
      </label>
      {serverError ? (
        <div className="md:col-span-2">
          <Notice tone="error">{serverError}</Notice>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3 md:col-span-2">
        <button type="submit" className={BUTTON_PRIMARY} disabled={busy || styles.length === 0}>
          Создать материал
        </button>
        <button type="button" className={BUTTON_SECONDARY} onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  );
}

// Первая ошибка по полю: её и показываем рядом с полем.
function collectErrors(
  issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[],
) {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? 'form');
    errors[key] ??= issue.message;
  }
  return errors;
}
