import { sql, type SQL } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  ARTICLE_FORMATS,
  ARTICLE_STATUSES,
  FACT_STATUSES,
  FACT_TYPES,
  GENERATION_STATUSES,
  METRIC_SOURCES,
  PUBLICATION_CHANNELS,
  PUBLICATION_STATUSES,
  REVIEW_DECISIONS,
  TONES,
  USER_ROLES,
  VERSION_ORIGINS,
} from '@dzenwriter/shared';

// Значения берутся из общих констант, поэтому БД и код не расходятся.
function oneOf(column: string, values: readonly string[]): SQL {
  return sql.raw(`${column} IN (${values.map((value) => `'${value}'`).join(', ')})`);
}

// UUID по умолчанию генерирует сама БД (gen_random_uuid), поэтому NULL в id невозможен
// даже при вставке мимо ORM.
const uuidId = () => uuid('id').primaryKey().defaultRandom();
const timestampTz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => timestampTz('created_at').notNull().defaultNow();

export const users = pgTable(
  'users',
  {
    id: uuidId(),
    githubId: bigint('github_id', { mode: 'number' }).notNull().unique(),
    login: text('login').notNull().unique(),
    name: text('name'),
    role: text('role').notNull().default('author'),
    createdAt: createdAt(),
    disabledAt: timestampTz('disabled_at'),
  },
  (table) => [check('users_role_check', oneOf(table.role.name, USER_ROLES))],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuidId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: createdAt(),
    expiresAt: timestampTz('expires_at').notNull(),
    revokedAt: timestampTz('revoked_at'),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
);

export const products = pgTable('products', {
  id: uuidId(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  oneLiner: text('one_liner').notNull(),
  createdAt: createdAt(),
  archivedAt: timestampTz('archived_at'),
});

export const articles = pgTable(
  'articles',
  {
    id: uuidId(),
    topic: text('topic').notNull(),
    keywords: text('keywords')
      .array()
      .notNull()
      .default(sql`'{}'`),
    title: text('title'),
    // Бриф (план) статьи до генерации текста: Markdown, nullable.
    brief: text('brief'),
    styleId: text('style_id').notNull(),
    format: text('format').notNull(),
    tone: text('tone').notNull(),
    lengthMin: integer('length_min').notNull(),
    lengthMax: integer('length_max').notNull(),
    productId: uuid('product_id').references(() => products.id),
    status: text('status').notNull(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    reviewerId: uuid('reviewer_id').references(() => users.id),
    currentVersionNumber: integer('current_version_number'),
    plannedAt: timestampTz('planned_at'),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: timestampTz('updated_at').notNull().defaultNow(),
    archivedAt: timestampTz('archived_at'),
  },
  (table) => [
    check('articles_status_check', oneOf(table.status.name, ARTICLE_STATUSES)),
    check('articles_format_check', oneOf(table.format.name, ARTICLE_FORMATS)),
    check('articles_tone_check', oneOf(table.tone.name, TONES)),
    check('articles_length_check', sql.raw('length_min > 0 AND length_min <= length_max')),
    index('articles_status_planned_at_idx').on(table.status, table.plannedAt),
    index('articles_owner_status_idx').on(table.ownerId, table.status),
  ],
);

export const facts = pgTable(
  'facts',
  {
    id: uuidId(),
    type: text('type').notNull(),
    text: text('text').notNull(),
    sourceName: text('source_name'),
    sourceUrl: text('source_url'),
    sourcePublishedAt: date('source_published_at', { mode: 'string' }),
    productId: uuid('product_id').references(() => products.id),
    status: text('status').notNull().default('draft'),
    mentionsClient: boolean('mentions_client').notNull().default(false),
    clientPermission: boolean('client_permission').notNull().default(false),
    consentConfirmed: boolean('consent_confirmed').notNull().default(false),
    consentConfirmedBy: uuid('consent_confirmed_by').references(() => users.id),
    consentConfirmedAt: timestampTz('consent_confirmed_at'),
    anonymized: boolean('anonymized').notNull().default(false),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    approvedBy: uuid('approved_by').references(() => users.id),
    approvedAt: timestampTz('approved_at'),
    supersedesId: uuid('supersedes_id').references((): AnyPgColumn => facts.id),
    supersededBy: uuid('superseded_by').references((): AnyPgColumn => facts.id),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: timestampTz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check('facts_type_check', oneOf(table.type.name, FACT_TYPES)),
    check('facts_status_check', oneOf(table.status.name, FACT_STATUSES)),
    check('facts_supersedes_self_check', sql.raw('supersedes_id IS NULL OR supersedes_id <> id')),
    check(
      'facts_news_source_approved_check',
      sql.raw(
        "status <> 'approved' OR type <> 'news_source' OR (source_url IS NOT NULL AND source_published_at IS NOT NULL)",
      ),
    ),
    check(
      'facts_experience_approved_check',
      sql.raw(
        "status <> 'approved' OR type <> 'experience_note' OR (consent_confirmed AND anonymized)",
      ),
    ),
    check(
      'facts_product_approved_check',
      sql.raw("status <> 'approved' OR type <> 'product_fact' OR product_id IS NOT NULL"),
    ),
    index('facts_type_status_idx').on(table.type, table.status),
    index('facts_supersedes_id_idx').on(table.supersedesId),
    index('facts_text_search_idx').using('gin', sql`to_tsvector('russian', ${table.text})`),
  ],
);

export const articleFacts = pgTable(
  'article_facts',
  {
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    factId: uuid('fact_id')
      .notNull()
      .references(() => facts.id),
    label: text('label').notNull(),
    addedBy: uuid('added_by')
      .notNull()
      .references(() => users.id),
    addedAt: timestampTz('added_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.articleId, table.factId] }),
    unique('article_facts_article_label_unique').on(table.articleId, table.label),
  ],
);

export const generationRuns = pgTable(
  'generation_runs',
  {
    id: uuidId(),
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    inputSnapshot: jsonb('input_snapshot').notNull().default({}),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    latencyMs: integer('latency_ms'),
    costUsd: numeric('cost_usd', { precision: 10, scale: 4 }),
    errorCode: text('error_code'),
    // Вопросы автору из ответа needs_input: версия при этом не создаётся, вопросы живут здесь.
    questions: jsonb('questions').notNull().default([]),
    idempotencyKey: text('idempotency_key').unique(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    finishedAt: timestampTz('finished_at'),
  },
  (table) => [
    check('generation_runs_status_check', oneOf(table.status.name, GENERATION_STATUSES)),
    index('generation_runs_article_created_at_idx').on(table.articleId, table.createdAt),
  ],
);

// Подтверждение ревьюера на запуск генерации для темы вне фокуса ИИ.
// Одно подтверждение на материал: тема не меняет фокус, а подтверждение не переиспользуется.
export const articleGenerationConfirmations = pgTable(
  'article_generation_confirmations',
  {
    id: uuidId(),
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    confirmedBy: uuid('confirmed_by')
      .notNull()
      .references(() => users.id),
    confirmedAt: timestampTz('confirmed_at').notNull().defaultNow(),
  },
  (table) => [
    unique('article_generation_confirmations_article_unique').on(table.articleId),
    index('article_generation_confirmations_article_idx').on(table.articleId),
  ],
);

export const articleVersions = pgTable(
  'article_versions',
  {
    id: uuidId(),
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    origin: text('origin').notNull(),
    title: text('title').notNull(),
    articleMarkdown: text('article_markdown').notNull(),
    seoTitle: text('seo_title').notNull(),
    tags: text('tags').array().notNull(),
    description: text('description').notNull(),
    imagePrompt: text('image_prompt').notNull(),
    advertisingLabel: boolean('advertising_label').notNull().default(false),
    disclaimerText: text('disclaimer_text'),
    claims: jsonb('claims').notNull().default([]),
    checks: jsonb('checks').notNull().default([]),
    styleVersion: integer('style_version').notNull(),
    promptVersion: text('prompt_version').notNull(),
    generationRunId: uuid('generation_run_id').references(() => generationRuns.id),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [
    unique('article_versions_article_number_unique').on(table.articleId, table.number),
    check('article_versions_origin_check', oneOf(table.origin.name, VERSION_ORIGINS)),
  ],
);

export const reviews = pgTable(
  'reviews',
  {
    id: uuidId(),
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    reviewerId: uuid('reviewer_id')
      .notNull()
      .references(() => users.id),
    decision: text('decision').notNull(),
    comment: text('comment'),
    // Оценка редактора по итогам ревью: 1–5, необязательная.
    rating: smallint('rating'),
    // Рубрика редактора (раздел 7.4 дизайна): пять критериев 1–5, заполняются вместе.
    rubricAccuracy: smallint('rubric_accuracy'),
    rubricStyle: smallint('rubric_style'),
    rubricReadability: smallint('rubric_readability'),
    rubricHooks: smallint('rubric_hooks'),
    rubricCliches: smallint('rubric_cliches'),
    createdAt: createdAt(),
  },
  (table) => [
    check('reviews_decision_check', oneOf(table.decision.name, REVIEW_DECISIONS)),
    check('reviews_comment_check', sql.raw("decision = 'approved' OR comment IS NOT NULL")),
    check('reviews_rating_check', sql`rating is null or (rating >= 1 and rating <= 5)`),
    check(
      'reviews_rubric_check',
      sql`(
        (rubric_accuracy is null or (rubric_accuracy >= 1 and rubric_accuracy <= 5)) and
        (rubric_style is null or (rubric_style >= 1 and rubric_style <= 5)) and
        (rubric_readability is null or (rubric_readability >= 1 and rubric_readability <= 5)) and
        (rubric_hooks is null or (rubric_hooks >= 1 and rubric_hooks <= 5)) and
        (rubric_cliches is null or (rubric_cliches >= 1 and rubric_cliches <= 5))
      )`,
    ),
  ],
);

export const publications = pgTable(
  'publications',
  {
    id: uuidId(),
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(),
    status: text('status').notNull(),
    scheduledAt: timestampTz('scheduled_at'),
    publishedAt: timestampTz('published_at'),
    externalUrl: text('external_url'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [
    check('publications_channel_check', oneOf(table.channel.name, PUBLICATION_CHANNELS)),
    check('publications_status_check', oneOf(table.status.name, PUBLICATION_STATUSES)),
    check(
      'publications_published_url_check',
      sql.raw("status <> 'published' OR external_url IS NOT NULL"),
    ),
  ],
);

export const metricSnapshots = pgTable(
  'metric_snapshots',
  {
    id: uuidId(),
    publicationId: uuid('publication_id')
      .notNull()
      .references(() => publications.id, { onDelete: 'cascade' }),
    capturedOn: date('captured_on', { mode: 'string' }).notNull(),
    views: integer('views').notNull().default(0),
    reads: integer('reads').notNull().default(0),
    avgReadSeconds: integer('avg_read_seconds'),
    source: text('source').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [
    unique('metric_snapshots_publication_day_unique').on(table.publicationId, table.capturedOn),
    check('metric_snapshots_source_check', oneOf(table.source.name, METRIC_SOURCES)),
  ],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (table) => [index('audit_log_entity_idx').on(table.entityType, table.entityId, table.createdAt)],
);
