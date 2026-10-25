import { z } from 'zod';
import { personRefSchema } from './articles';
import {
  ARTICLE_STATUSES,
  FACT_STATUSES,
  FACT_TYPES,
  type FactPolicy,
  type FactType,
} from './enums';

export const FACT_TEXT_MAX_LENGTH = 20_000;
export const FACT_SOURCE_NAME_MAX_LENGTH = 200;

// Какие типы фактов допускает политика стиля (docs/01-writing-styles, раздел 1).
export const FACT_TYPES_BY_POLICY: Readonly<Record<FactPolicy, readonly FactType[]>> = {
  sourced: ['news_source'],
  approved_only: ['company_fact', 'product_fact'],
  experience_only: ['experience_note'],
};

export function policyAllowsFactType(policy: FactPolicy, type: FactType): boolean {
  return FACT_TYPES_BY_POLICY[policy].includes(type);
}

const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;

// Москва живёт без летнего времени: UTC+3 круглый год.
function todayInMoscow(): string {
  return new Date(Date.now() + MOSCOW_OFFSET_MS).toISOString().slice(0, 10);
}

const textSchema = z
  .string({ error: 'Введите текст факта' })
  .trim()
  .min(1, 'Текст факта не может быть пустым')
  .max(FACT_TEXT_MAX_LENGTH, `Текст длиннее ${FACT_TEXT_MAX_LENGTH} знаков`);
const sourceNameSchema = z
  .string()
  .trim()
  .max(
    FACT_SOURCE_NAME_MAX_LENGTH,
    `Название источника длиннее ${FACT_SOURCE_NAME_MAX_LENGTH} знаков`,
  );
const sourceUrlSchema = z.url({
  protocol: /^https?$/,
  error: 'Ссылка на источник должна начинаться с http:// или https://',
});
const publishedDateSchema = z.iso
  .date({ error: 'Дата публикации в формате ГГГГ-ММ-ДД' })
  .refine((date) => date <= todayInMoscow(), { error: 'Дата публикации не может быть в будущем' });
const versionSchema = z.number({ error: 'Укажите версию факта' }).int().min(1);

const fieldsShape = {
  text: textSchema,
  sourceName: sourceNameSchema.nullish(),
  sourceUrl: sourceUrlSchema.nullish(),
  sourcePublishedAt: publishedDateSchema.nullish(),
  productId: z.uuid({ error: 'Некорректный продукт' }).nullish(),
  mentionsClient: z.boolean().optional(),
  clientPermission: z.boolean().optional(),
};

interface TypedFields {
  readonly sourceUrl?: string | null | undefined;
  readonly sourcePublishedAt?: string | null | undefined;
  readonly productId?: string | null | undefined;
}

// Обязательные поля по типу: одни и те же правила для создания, правки и исправления.
function typeIssues(type: FactType, fields: TypedFields): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if (type === 'news_source') {
    if (!fields.sourceUrl) {
      issues.push({
        path: 'sourceUrl',
        message: 'Для источника новости укажите ссылку на материал',
      });
    }
    if (!fields.sourcePublishedAt) {
      issues.push({
        path: 'sourcePublishedAt',
        message: 'Для источника новости укажите дату публикации',
      });
    }
  }
  if (type === 'product_fact' && !fields.productId) {
    issues.push({ path: 'productId', message: 'Для факта о продукте выберите продукт' });
  }
  return issues;
}

export const factFieldsSchema = z.object(fieldsShape);
export type FactFields = z.infer<typeof factFieldsSchema>;

// Содержимое факта под конкретный тип: исправление берёт тип у исходного факта.
export function factContentSchema(type: FactType) {
  return z.object(fieldsShape).superRefine((fields, ctx) => {
    for (const issue of typeIssues(type, fields)) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: [issue.path] });
    }
  });
}

// Тело POST /api/v1/facts. Тип задаётся при создании и дальше не меняется.
export const createFactInputSchema = z
  .object({ type: z.enum(FACT_TYPES, { error: 'Выберите тип факта' }), ...fieldsShape })
  .superRefine((input, ctx) => {
    for (const issue of typeIssues(input.type, input)) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: [issue.path] });
    }
  });
export type CreateFactInput = z.infer<typeof createFactInputSchema>;

// Тело PATCH: правка только черновика. null очищает необязательное поле.
export const updateFactInputSchema = z.object({
  expectedVersion: versionSchema,
  ...fieldsShape,
  text: textSchema.optional(),
});
export type UpdateFactInput = z.infer<typeof updateFactInputSchema>;

// Тело одобрения, отклонения и отзыва согласия: версия, которую проверяли.
export const factVersionInputSchema = z.object({ expectedVersion: versionSchema });
export type FactVersionInput = z.infer<typeof factVersionInputSchema>;

export const factConsentInputSchema = z.object({
  expectedVersion: versionSchema,
  anonymized: z.boolean({ error: 'Укажите, обезличен ли текст' }),
});
export type FactConsentInput = z.infer<typeof factConsentInputSchema>;

export const factListQuerySchema = z.object({
  type: z.enum(FACT_TYPES).optional(),
  status: z.enum(FACT_STATUSES).optional(),
  productId: z.uuid().optional(),
  q: z.string().trim().min(1).max(200).optional(),
});
export type FactListQuery = z.infer<typeof factListQuerySchema>;

const actionStateSchema = z.object({
  allowed: z.boolean(),
  reason: z.string().nullable(),
});

// Какие действия доступны текущему пользователю и почему нет. Считает сервер по тем же правилам.
export const factActionsSchema = z.object({
  edit: actionStateSchema,
  approve: actionStateSchema,
  reject: actionStateSchema,
  confirmConsent: actionStateSchema,
  withdrawConsent: actionStateSchema,
  correct: actionStateSchema,
});
export type FactActions = z.infer<typeof factActionsSchema>;

export const factItemSchema = z.object({
  id: z.uuid(),
  type: z.enum(FACT_TYPES),
  status: z.enum(FACT_STATUSES),
  text: z.string(),
  sourceName: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  sourcePublishedAt: z.string().nullable(),
  productId: z.uuid().nullable(),
  productName: z.string().nullable(),
  mentionsClient: z.boolean(),
  clientPermission: z.boolean(),
  consentConfirmed: z.boolean(),
  consentConfirmedBy: z.string().nullable(),
  consentConfirmedAt: z.iso.datetime().nullable(),
  anonymized: z.boolean(),
  createdBy: personRefSchema,
  approvedBy: personRefSchema.nullable(),
  approvedAt: z.iso.datetime().nullable(),
  supersedesId: z.uuid().nullable(),
  supersededById: z.uuid().nullable(),
  hasPendingCorrection: z.boolean(),
  version: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  actions: factActionsSchema,
});
export type FactItem = z.infer<typeof factItemSchema>;

export const factListResponseSchema = z.object({
  items: z.array(factItemSchema),
  truncated: z.boolean(),
});
export type FactListResponse = z.infer<typeof factListResponseSchema>;

// Где факт используется: материалы, к которым он привязан. Свежие обновления раньше.
export const factUsageItemSchema = z.object({
  articleId: z.uuid(),
  topic: z.string(),
  status: z.enum(ARTICLE_STATUSES),
  updatedAt: z.iso.datetime(),
});
export type FactUsageItem = z.infer<typeof factUsageItemSchema>;

export const factUsageResponseSchema = z.object({
  items: z.array(factUsageItemSchema),
  truncated: z.boolean(),
});
export type FactUsageResponse = z.infer<typeof factUsageResponseSchema>;
