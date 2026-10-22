// Значения перечислений общие для БД, API и веб-клиента. Меняются только вместе с миграцией.

export const ARTICLE_STATUSES = [
  'idea',
  'researching',
  'drafting',
  'in_review',
  'approved',
  'scheduled',
  'published',
  'archived',
] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

export const ARTICLE_FORMATS = ['news', 'article', 'longread', 'roundup', 'case'] as const;
export type ArticleFormat = (typeof ARTICLE_FORMATS)[number];

export const TONES = ['neutral', 'expert-conversational', 'engaging'] as const;
export type Tone = (typeof TONES)[number];

export const FACT_TYPES = [
  'news_source',
  'company_fact',
  'product_fact',
  'experience_note',
] as const;
export type FactType = (typeof FACT_TYPES)[number];

export const FACT_STATUSES = ['draft', 'approved', 'rejected', 'superseded'] as const;
export type FactStatus = (typeof FACT_STATUSES)[number];

export const FACT_POLICIES = ['sourced', 'approved_only', 'experience_only'] as const;
export type FactPolicy = (typeof FACT_POLICIES)[number];

export const USER_ROLES = ['author', 'reviewer', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const GENERATION_STATUSES = [
  'running',
  'succeeded',
  'needs_input',
  'failed',
  'cancelled',
] as const;
export type GenerationStatus = (typeof GENERATION_STATUSES)[number];

export const REVIEW_DECISIONS = ['approved', 'changes_requested'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const PUBLICATION_STATUSES = ['scheduled', 'published'] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

export const PUBLICATION_CHANNELS = ['dzen'] as const;
export type PublicationChannel = (typeof PUBLICATION_CHANNELS)[number];

export const VERSION_ORIGINS = ['generated', 'manual'] as const;
export type VersionOrigin = (typeof VERSION_ORIGINS)[number];

export const METRIC_SOURCES = ['manual', 'csv'] as const;
export type MetricSource = (typeof METRIC_SOURCES)[number];

export const CHECK_SEVERITIES = ['block', 'warn', 'info'] as const;
export type CheckSeverity = (typeof CHECK_SEVERITIES)[number];

export const DISCLAIMER_TOPICS = ['medical', 'legal', 'financial'] as const;
export type DisclaimerTopic = (typeof DISCLAIMER_TOPICS)[number];

// Проверки, которые можно включать и настраивать в конфигурации стиля.
// Движок проверок (E7) обязан реализовать каждую из них.
export const STYLE_CHECK_IDS = [
  'numbers_must_map_to_facts',
  'names_must_map_to_facts',
  'claims_need_fact_ids',
  'superlatives_need_fact',
  'guarantees_forbidden',
  'first_person_expected',
  'personal_names_forbidden',
  'client_names_need_permission',
  'ad_disclosure_required',
  'source_date_required',
  'limitations_section_required',
] as const;
export type StyleCheckId = (typeof STYLE_CHECK_IDS)[number];
