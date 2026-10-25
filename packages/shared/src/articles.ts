import { z } from 'zod';
import {
  ARTICLE_FORMATS,
  ARTICLE_STATUSES,
  type ArticleStatus,
  DISCLAIMER_TOPICS,
  FACT_POLICIES,
  FACT_STATUSES,
  FACT_TYPES,
  PUBLICATION_CHANNELS,
  PUBLICATION_STATUSES,
  REVIEW_DECISIONS,
  TONES,
  VERSION_ORIGINS,
} from './enums';
import { generationAvailabilitySchema } from './generation';
import { versionCheckSchema } from './checks';

// Текст, параметры и факты меняются только до утверждения. Дальше материал возвращают в черновик.
export const CONTENT_EDITABLE_STATUSES: readonly ArticleStatus[] = [
  'idea',
  'researching',
  'drafting',
];

export const TOPIC_MIN_LENGTH = 3;
export const TOPIC_MAX_LENGTH = 300;
export const KEYWORDS_MAX_COUNT = 10;
export const LENGTH_LIMIT = 50_000;

const topicSchema = z
  .string()
  .trim()
  .min(TOPIC_MIN_LENGTH, `Тема короче ${TOPIC_MIN_LENGTH} знаков`)
  .max(TOPIC_MAX_LENGTH, `Тема длиннее ${TOPIC_MAX_LENGTH} знаков`);
const keywordsSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1, 'Ключевое слово не может быть пустым')
      .max(60, 'Ключевое слово длиннее 60 знаков'),
  )
  .max(KEYWORDS_MAX_COUNT, `Не больше ${KEYWORDS_MAX_COUNT} ключевых слов`);
const styleIdSchema = z.string().min(1, 'Выберите стиль');
const formatSchema = z.enum(ARTICLE_FORMATS, { error: 'Выберите формат' });
const toneSchema = z.enum(TONES, { error: 'Выберите тон' });
const lengthSchema = z
  .number({ error: 'Объём задаётся числом знаков' })
  .int('Объём задаётся целым числом знаков')
  .min(1, 'Объём должен быть больше нуля')
  .max(LENGTH_LIMIT, `Объём не больше ${LENGTH_LIMIT} знаков`);
const productIdSchema = z.uuid({ error: 'Некорректный продукт' }).nullable();
const plannedAtSchema = z.iso.datetime({ error: 'Некорректная плановая дата' }).nullable();

const lengthsInOrder = (input: { lengthMin?: number; lengthMax?: number }) =>
  input.lengthMin === undefined ||
  input.lengthMax === undefined ||
  input.lengthMin <= input.lengthMax;
const LENGTH_ORDER_MESSAGE = 'Минимальный объём больше максимального';

// Тело POST /api/v1/articles. Пустые значения объёма и тона берутся из формата и стиля на сервере.
export const createArticleInputSchema = z
  .object({
    topic: topicSchema,
    keywords: keywordsSchema.default([]),
    styleId: styleIdSchema,
    format: formatSchema,
    tone: toneSchema.optional(),
    lengthMin: lengthSchema.optional(),
    lengthMax: lengthSchema.optional(),
    productId: productIdSchema.optional(),
    plannedAt: plannedAtSchema.optional(),
  })
  .refine(lengthsInOrder, { error: LENGTH_ORDER_MESSAGE });
export type CreateArticleInput = z.infer<typeof createArticleInputSchema>;

// Тело PATCH: версия обязательна, чтобы не перезаписать чужую правку.
export const updateArticleInputSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    topic: topicSchema.optional(),
    keywords: keywordsSchema.optional(),
    styleId: styleIdSchema.optional(),
    format: formatSchema.optional(),
    tone: toneSchema.optional(),
    lengthMin: lengthSchema.optional(),
    lengthMax: lengthSchema.optional(),
    productId: productIdSchema.optional(),
    plannedAt: plannedAtSchema.optional(),
  })
  .refine(lengthsInOrder, { error: LENGTH_ORDER_MESSAGE });
export type UpdateArticleInput = z.infer<typeof updateArticleInputSchema>;

// Ссылка на публикацию в Дзене: только https и домены Дзена.
export const publicationUrlSchema = z.url({
  protocol: /^https$/,
  hostname: /^(?:[a-z0-9-]+\.)*(?:dzen\.ru|zen\.yandex\.ru)$/i,
  error: 'Ссылка должна вести на dzen.ru или zen.yandex.ru по https',
});

// Рубрика редактора (раздел 7.4 дизайна): пять критериев, каждый 1–5, заполняются вместе.
export const reviewRubricSchema = z.object({
  accuracy: z.number().int().min(1).max(5),
  style: z.number().int().min(1).max(5),
  readability: z.number().int().min(1).max(5),
  hooks: z.number().int().min(1).max(5),
  cliches: z.number().int().min(1).max(5),
});
export type ReviewRubric = z.infer<typeof reviewRubricSchema>;

export const transitionInputSchema = z.object({
  to: z.enum(ARTICLE_STATUSES, { error: 'Неизвестный статус' }),
  expectedVersion: z.number().int().min(1),
  comment: z.string().trim().max(2000, 'Комментарий длиннее 2000 знаков').optional(),
  externalUrl: publicationUrlSchema.optional(),
  // Оценка редактора при утверждении: рубрика из пяти критериев, необязательная.
  rubric: reviewRubricSchema.optional(),
});
export type TransitionInput = z.infer<typeof transitionInputSchema>;

// Параметры GET /api/v1/articles. Булевы флаги приходят строками из query.
const flagSchema = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => value === 'true');
export const articleListQuerySchema = z.object({
  status: z.enum(ARTICLE_STATUSES).optional(),
  styleId: z.string().min(1).optional(),
  ownerId: z.uuid().optional(),
  mine: flagSchema,
  includeArchived: flagSchema,
  plannedFrom: z.iso.datetime().optional(),
  plannedTo: z.iso.datetime().optional(),
});
export type ArticleListQuery = z.infer<typeof articleListQuerySchema>;

export const personRefSchema = z.object({
  id: z.uuid(),
  login: z.string(),
  name: z.string().nullable(),
});
export type PersonRef = z.infer<typeof personRefSchema>;

export const articleItemSchema = z.object({
  id: z.uuid(),
  topic: z.string(),
  keywords: z.array(z.string()),
  title: z.string().nullable(),
  styleId: z.string(),
  styleName: z.string(),
  format: z.enum(ARTICLE_FORMATS),
  tone: z.enum(TONES),
  lengthMin: z.number().int(),
  lengthMax: z.number().int(),
  productId: z.uuid().nullable(),
  status: z.enum(ARTICLE_STATUSES),
  owner: personRefSchema,
  reviewer: personRefSchema.nullable(),
  plannedAt: z.iso.datetime().nullable(),
  currentVersionNumber: z.number().int().nullable(),
  // Блокирующие проверки текущей версии: карточка доски показывает их без открытия материала.
  blockingChecks: z.number().int().nonnegative(),
  version: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ArticleItem = z.infer<typeof articleItemSchema>;

// Что нужно стилю для перехода к черновику: факты, продукт, объём заметок опыта.
export const requirementSchema = z.object({
  title: z.string(),
  required: z.number().int(),
  actual: z.number().int(),
  met: z.boolean(),
});

export const transitionOptionSchema = z.object({
  to: z.enum(ARTICLE_STATUSES),
  allowed: z.boolean(),
  reason: z.string().nullable(),
  needsComment: z.boolean(),
  needsUrl: z.boolean(),
});
export type TransitionOption = z.infer<typeof transitionOptionSchema>;

export const versionSummarySchema = z.object({
  number: z.number().int(),
  origin: z.enum(VERSION_ORIGINS),
  advertisingLabel: z.boolean(),
  blockingChecks: z.number().int(),
  createdAt: z.iso.datetime(),
  createdBy: z.string(),
});

export const reviewSummarySchema = z.object({
  decision: z.enum(REVIEW_DECISIONS),
  comment: z.string().nullable(),
  versionNumber: z.number().int(),
  reviewerLogin: z.string(),
  rating: z.number().int().min(1).max(5).nullable(),
  rubric: reviewRubricSchema.nullable(),
  createdAt: z.iso.datetime(),
});

export const publicationSummarySchema = z.object({
  channel: z.enum(PUBLICATION_CHANNELS),
  status: z.enum(PUBLICATION_STATUSES),
  externalUrl: z.string().nullable(),
  scheduledAt: z.iso.datetime().nullable(),
  publishedAt: z.iso.datetime().nullable(),
});

export const factLinkSchema = z.object({
  factId: z.uuid(),
  label: z.string(),
  type: z.enum(FACT_TYPES),
  status: z.enum(FACT_STATUSES),
  text: z.string(),
  sourceName: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  sourcePublishedAt: z.string().nullable(),
});

// Тело POST /api/v1/articles/{id}/facts: метка F<n> назначается сервером.
export const attachFactInputSchema = z.object({
  factId: z.uuid({ error: 'Выберите факт из библиотеки' }),
});
export type AttachFactInput = z.infer<typeof attachFactInputSchema>;

export const articleDetailSchema = articleItemSchema.extend({
  requirements: z.array(requirementSchema),
  transitions: z.array(transitionOptionSchema),
  versions: z.array(versionSummarySchema),
  reviews: z.array(reviewSummarySchema),
  publications: z.array(publicationSummarySchema),
  facts: z.array(factLinkSchema),
  // Проверки текущей версии: автор снимает их подтверждением с комментарием.
  checks: z.array(versionCheckSchema),
  // Доступность запуска генерации с причиной. Правила считает сервер.
  generation: generationAvailabilitySchema,
});
export type ArticleDetail = z.infer<typeof articleDetailSchema>;

export const articleListResponseSchema = z.object({
  items: z.array(articleItemSchema),
  truncated: z.boolean(),
});
export type ArticleListResponse = z.infer<typeof articleListResponseSchema>;

export const createArticleResponseSchema = z.object({
  article: articleDetailSchema,
  warnings: z.array(z.string()),
});
export type CreateArticleResponse = z.infer<typeof createArticleResponseSchema>;

// Каталог стилей и форматов только для чтения: они лежат в config/ и меняются через PR.
export const styleCardSchema = z.object({
  id: z.string(),
  name: z.string(),
  summary: z.string(),
  audience: z.string(),
  version: z.number().int(),
  allowedFormats: z.array(z.enum(ARTICLE_FORMATS)),
  defaultTone: z.enum(TONES),
  voice: z.object({
    person: z.enum(['first', 'we', 'third']),
    register: z.string(),
    readerAddress: z.enum(['you', 'none']),
  }),
  factPolicy: z.enum(FACT_POLICIES),
  inputs: z.object({
    requiredFactTypes: z.array(z.enum(FACT_TYPES)),
    minFacts: z.number().int(),
    minNoteChars: z.number().int().nullable(),
    requiresProduct: z.boolean(),
    requiresConsent: z.boolean(),
    requiresAnonymization: z.boolean(),
  }),
  checks: z.array(z.object({ id: z.string(), severity: z.enum(['block', 'warn']) })),
  disclaimer: z.object({
    forTopics: z.array(z.enum(DISCLAIMER_TOPICS)),
    always: z.boolean(),
    text: z.string(),
  }),
});
export type StyleCard = z.infer<typeof styleCardSchema>;

const lengthRangeSchema = z.object({ min: z.number().int(), max: z.number().int() });
export const formatCardSchema = z.object({
  id: z.enum(ARTICLE_FORMATS),
  name: z.string(),
  length: lengthRangeSchema,
  blocks: lengthRangeSchema.nullable(),
  items: lengthRangeSchema.nullable(),
  structure: z.string(),
});
export type FormatCard = z.infer<typeof formatCardSchema>;

export const styleListResponseSchema = z.object({ items: z.array(styleCardSchema) });
export const formatListResponseSchema = z.object({ items: z.array(formatCardSchema) });
