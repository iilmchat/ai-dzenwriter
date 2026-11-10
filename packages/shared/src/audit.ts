import { z } from 'zod';

// Запись журнала: кто, что и когда изменил. В payload только ID и значения
// ролей, без логинов и имён; имя пользователя выводится отдельно.
export const auditEntrySchema = z.object({
  id: z.number().int().nonnegative(),
  actorId: z.uuid().nullable(),
  actorLogin: z.string().nullable(),
  actorName: z.string().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const auditListResponseSchema = z.object({
  items: z.array(auditEntrySchema),
  truncated: z.boolean(),
});
export type AuditListResponse = z.infer<typeof auditListResponseSchema>;

// Фильтры журнала: кто, действие, сущность и период. Границы периода —
// полные моменты времени, день по Москве разворачивается на клиенте.
export const auditQuerySchema = z
  .object({
    actorId: z.uuid().optional(),
    action: z.string().min(1).max(64).optional(),
    entityType: z.string().min(1).max(32).optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
  })
  .refine((input) => input.from === undefined || input.to === undefined || input.from <= input.to, {
    error: 'Начало периода позже конца',
  });
export type AuditQuery = z.infer<typeof auditQuerySchema>;

// Действия в журнале. Значения в коде остаются латиницей, подписи — в labels.
export const AUDIT_ACTIONS = [
  'auth.login',
  'auth.logout',
  'auth.denied',
  'auth.login_conflict',
  'user.role_change',
  'user.disable',
  'user.enable',
  'user.membership_lost',
  'product.create',
  'product.update',
  'fact.create',
  'fact.update',
  'fact.supersede',
  'fact.approve',
  'fact.reject',
  'fact.correct',
  'consent.confirm',
  'consent.withdraw',
  'article.create',
  'article.update',
  'article.transition',
  'article.fact_attach',
  'article.fact_detach',
  'article.generation_confirm',
  'article.brief_generate',
  'article.package_download',
  'version.create',
  'version.rollback',
  'check.confirm',
  'generation.start',
  'generation.succeeded',
  'generation.cancelled',
  'generation.failed',
  'generation.needs_input',
  'generation.fragment',
  'generation.title_options',
  'metric.create',
  'metric.import',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

// Типы сущностей журнала.
export const AUDIT_ENTITIES = [
  'user',
  'session',
  'product',
  'fact',
  'article',
  'metric_import',
] as const;
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];
