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
