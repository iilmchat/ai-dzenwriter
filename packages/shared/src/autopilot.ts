import { z } from 'zod';

export const autopilotExtractInputSchema = z.object({
  rawTask: z
    .string()
    .trim()
    .min(20, 'Задание слишком короткое')
    .max(50_000, 'Задание длиннее 50 000 знаков'),
  topic: z.string().trim().min(3, 'Укажите тему').max(300, 'Тема длиннее 300 знаков'),
});
export type AutopilotExtractInput = z.infer<typeof autopilotExtractInputSchema>;

export const autopilotExtractResponseSchema = z.object({
  articleId: z.uuid(),
  factsCreated: z.number().int().nonnegative(),
});
export type AutopilotExtractResponse = z.infer<typeof autopilotExtractResponseSchema>;

// Ответ модели при извлечении фактов. Поля snake_case повторяют промпт.
export const extractedFactsSchema = z.object({
  facts: z.array(
    z.object({
      text: z.string().trim().min(1),
      type: z.enum(['news_source', 'company_fact']),
      source_url: z.string().url().nullable().optional(),
      source_published_at: z.string().nullable().optional(),
    }),
  ),
});
export type ExtractedFacts = z.infer<typeof extractedFactsSchema>;
export type ExtractedFact = ExtractedFacts['facts'][number];

export const AUTOPILOT_STAGES = ['brief', 'generate', 'checks', 'refine', 'done'] as const;
export type AutopilotStage = (typeof AUTOPILOT_STAGES)[number];

export const autopilotEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('stage'),
    stage: z.enum(AUTOPILOT_STAGES),
    message: z.string(),
    iteration: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal('result'),
    versionNumber: z.number().int().positive().nullable(),
    iterations: z.number().int().nonnegative(),
    blocking: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('error'),
    message: z.string(),
  }),
]);
export type AutopilotEvent = z.infer<typeof autopilotEventSchema>;
