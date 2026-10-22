import { z } from 'zod';
import { GENERATION_STATUSES, type GenerationStatus } from './enums';

// Тип утверждения в ответе модели: факт со ссылкой на факты, гипотеза или оценка.
export const CLAIM_TYPES = ['fact', 'hypothesis', 'opinion'] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const CLAIM_TYPE_LABELS: Record<ClaimType, string> = {
  fact: 'факт',
  hypothesis: 'гипотеза',
  opinion: 'оценка',
};

// Утверждение в том виде, как его отдаёт модель: имена полей совпадают с промптом.
export const modelClaimSchema = z.object({
  text: z.string().min(1),
  type: z.enum(CLAIM_TYPES),
  fact_ids: z.array(z.string().min(1)).default([]),
});
export type ModelClaim = z.infer<typeof modelClaimSchema>;

// Контракт ответа модели, раздел 7.2 дизайна. Имена полей как в промпте: article_markdown,
// seo_title, fact_ids. Сервис превращает их в camelCase для хранения и интерфейса.
export const generationOutputSchema = z
  .object({
    status: z.enum(['ok', 'needs_input']),
    title: z.string().min(1),
    article_markdown: z.string().min(1),
    seo_title: z.string().min(1),
    tags: z.array(z.string().min(1)),
    description: z.string().min(1),
    image_prompt: z.string().min(1),
    claims: z.array(modelClaimSchema).default([]),
    questions: z.array(z.string().min(1)).default([]),
    advertising_label_suggested: z.boolean().default(false),
    disclaimer_needed: z.boolean().default(false),
  })
  .superRefine((output, ctx) => {
    // needs_input без вопросов бесполезен автору: повтор не поможет, а вопросов не будет.
    if (output.status === 'needs_input' && output.questions.length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'status needs_input требует хотя бы одного вопроса',
        path: ['questions'],
      });
    }
    output.claims.forEach((claim, index) => {
      // Утверждение о факте без ссылки на факт нарушает главное правило: нет факта — нет утверждения.
      if (claim.type === 'fact' && claim.fact_ids.length === 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'утверждение типа fact требует fact_ids',
          path: ['claims', index, 'fact_ids'],
        });
      }
    });
  });
export type GenerationOutput = z.infer<typeof generationOutputSchema>;

// Утверждение в виде, в котором оно хранится в jsonb и показывается в интерфейсе.
export const claimSchema = z.object({
  text: z.string(),
  type: z.enum(CLAIM_TYPES),
  factIds: z.array(z.string()),
});
export type Claim = z.infer<typeof claimSchema>;

// Стадии генерации в SSE. Клиент показывает их как есть: порядок не меняется.
export const GENERATION_STAGES = ['prompt', 'generate', 'parse', 'checks'] as const;
export type GenerationStage = (typeof GENERATION_STAGES)[number];

export const GENERATION_STAGE_LABELS: Record<GenerationStage, string> = {
  prompt: 'Сборка промпта',
  generate: 'Генерация',
  parse: 'Разбор ответа',
  checks: 'Проверки',
};

export const generationStageSchema = z.object({
  stage: z.enum(GENERATION_STAGES),
  status: z.enum(['running', 'done', 'skipped', 'failed']),
  message: z.string().optional(),
  // Счётчик токенов появляется после генерации: он считается по ответу провайдера.
  tokens: z.number().int().nonnegative().optional(),
});
export type GenerationStageEvent = z.infer<typeof generationStageSchema>;

// Итог запуска. При needs_input вопросы идут в ответе, версия при этом не создаётся.
export const generationResultSchema = z.object({
  runId: z.uuid(),
  status: z.enum(GENERATION_STATUSES),
  versionNumber: z.number().int().nullable(),
  inputTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  latencyMs: z.number().int().nullable(),
  questions: z.array(z.string()),
  errorCode: z.string().nullable(),
});
export type GenerationResult = z.infer<typeof generationResultSchema>;

// Запуск в истории материала.
export const generationRunSummarySchema = z.object({
  id: z.uuid(),
  status: z.enum(GENERATION_STATUSES),
  provider: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  inputTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  latencyMs: z.number().int().nullable(),
  // Стоимость приходит строкой: numeric в БД не должен превращаться в float.
  costUsd: z.string().nullable(),
  errorCode: z.string().nullable(),
  questions: z.array(z.string()),
  versionNumber: z.number().int().nullable(),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  createdBy: z.string(),
});
export type GenerationRunSummary = z.infer<typeof generationRunSummarySchema>;

export const generationRunListResponseSchema = z.object({
  items: z.array(generationRunSummarySchema),
});
export type GenerationRunListResponse = z.infer<typeof generationRunListResponseSchema>;

// Ответ на отмену запуска.
export const generationCancelResponseSchema = z.object({
  run: generationRunSummarySchema,
});
export type GenerationCancelResponse = z.infer<typeof generationCancelResponseSchema>;

// Причина, по которой генерация недоступна. Считает сервер: интерфейс не дублирует правила.
export const generationAvailabilitySchema = z.object({
  allowed: z.boolean(),
  reason: z.string().nullable(),
  // Тема вне фокуса ИИ: запуск подтверждает ревьюер.
  outOfFocus: z.boolean(),
  confirmed: z.boolean(),
});
export type GenerationAvailability = z.infer<typeof generationAvailabilitySchema>;

// Статусы запуска, которые сервер считает незавершёнными: их можно отменить.
export function isGenerationRunning(status: GenerationStatus): boolean {
  return status === 'running';
}
