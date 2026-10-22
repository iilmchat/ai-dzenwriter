import { z } from 'zod';
import { CHECK_SEVERITIES, STYLE_CHECK_IDS, type CheckSeverity } from './enums';

// Общие проверки для всех стилей. Уровень задан правилами движка, стилем они не настраиваются.
export const COMMON_CHECK_IDS = [
  'disclaimer_required',
  'title_length',
  'seo_title_length',
  'tags_count',
  'length_in_range',
  'banned_phrases',
  'clickbait_phrases',
  'hook_every_3_paragraphs',
  'paragraph_length',
] as const;
export type CommonCheckId = (typeof COMMON_CHECK_IDS)[number];

export const ALL_CHECK_IDS = [...STYLE_CHECK_IDS, ...COMMON_CHECK_IDS] as const;
export type AllCheckId = (typeof ALL_CHECK_IDS)[number];

// Подписи проверок для интерфейса и сообщений.
export const CHECK_LABELS: Record<AllCheckId, string> = {
  numbers_must_map_to_facts: 'Числа только из фактов',
  names_must_map_to_facts: 'Имена только из фактов',
  claims_need_fact_ids: 'Утверждения ссылаются на факты',
  superlatives_need_fact: 'Превосходные степени подтверждены',
  guarantees_forbidden: 'Без обещаний и гарантий',
  first_person_expected: 'От первого лица',
  personal_names_forbidden: 'Без имён людей и компаний',
  client_names_need_permission: 'Клиент назван с разрешения',
  ad_disclosure_required: 'Маркировка рекламы',
  source_date_required: 'У источника есть дата',
  limitations_section_required: 'Раздел об ограничениях',
  disclaimer_required: 'Оговорка для чувствительной темы',
  title_length: 'Длина заголовка',
  seo_title_length: 'Длина SEO-заголовка',
  tags_count: 'Число тегов',
  length_in_range: 'Объём в диапазоне формата',
  banned_phrases: 'Без штампов',
  clickbait_phrases: 'Без кликбейта',
  hook_every_3_paragraphs: 'Крючок каждые три абзаца',
  paragraph_length: 'Длина абзаца',
};

export const CHECK_SEVERITY_LABELS: Record<CheckSeverity, string> = {
  block: 'Блокирует',
  warn: 'Предупреждение',
  info: 'Замечание',
};

// Решение автора по сработавшей проверке. Подтверждение снимает блокировку и попадает в аудит.
export const CHECK_DECISIONS = ['confirmed'] as const;
export type CheckDecision = (typeof CHECK_DECISIONS)[number];

// Результат проверки в версии статьи. Хранится в jsonb, поэтому позиция и решение
// автора — часть той же записи.
export const versionCheckSchema = z.object({
  // Идентификатор проверки из ALL_CHECK_IDS.
  id: z.string().min(1),
  severity: z.enum(CHECK_SEVERITIES),
  message: z.string(),
  // Смещение фрагмента в article_markdown: по нему редактор подсвечивает место.
  start: z.number().int().nonnegative().optional(),
  end: z.number().int().nonnegative().optional(),
  excerpt: z.string().optional(),
  // Решение автора: подтверждение с комментарием снимает блокировку.
  decision: z.enum(CHECK_DECISIONS).optional(),
  comment: z.string().optional(),
  confirmedBy: z.string().optional(),
  confirmedAt: z.iso.datetime().optional(),
});
export type VersionCheck = z.infer<typeof versionCheckSchema>;

// Блокируют переход на ревью, если автор не подтвердил проверку.
export function isBlocking(check: VersionCheck): boolean {
  return check.severity === 'block' && check.decision !== 'confirmed';
}

export function countBlockingChecks(checks: readonly VersionCheck[]): number {
  return checks.filter(isBlocking).length;
}

// Утверждение в версии: текст, тип и ссылки на факты плюс его место в статье.
export const versionClaimSchema = z.object({
  text: z.string(),
  type: z.enum(['fact', 'hypothesis', 'opinion']),
  factIds: z.array(z.string()),
  // Смещение утверждения в article_markdown.
  start: z.number().int().nonnegative().optional(),
  end: z.number().int().nonnegative().optional(),
});
export type VersionClaim = z.infer<typeof versionClaimSchema>;

// Подтверждение проверки автором. Комментарий обязателен: решение объясняется
// и попадает в аудит.
export const confirmCheckInputSchema = z.object({
  comment: z
    .string()
    .trim()
    .min(1, 'Напишите, почему проверку можно снять')
    .max(2000, 'Комментарий длиннее 2000 знаков'),
});
export type ConfirmCheckInput = z.infer<typeof confirmCheckInputSchema>;

export const checkSeveritySchema = z.enum(CHECK_SEVERITIES);
export type { CheckSeverity };
