import { z } from 'zod';

// Период отчёта: даты по Москве, границы включаются.
export const pilotMetricsQuerySchema = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .refine((input) => input.from === undefined || input.to === undefined || input.from <= input.to, {
    error: 'Начало периода позже конца',
  });
export type PilotMetricsQuery = z.infer<typeof pilotMetricsQuerySchema>;

const ratioSchema = z.number().min(0).max(1).nullable();

export const pilotMetricsResponseSchema = z.object({
  period: z.object({
    from: z.iso.date().nullable(),
    to: z.iso.date().nullable(),
  }),
  articles: z.object({
    total: z.number().int().nonnegative(),
    approved: z.number().int().nonnegative(),
    reviewed: z.number().int().nonnegative(),
    // Медиана времени от создания материала до первого утверждения, в часах.
    approvalMedianHours: z.number().nonnegative().nullable(),
    approvedWithoutReturn: z.number().int().nonnegative(),
    approvedWithoutReturnShare: ratioSchema,
    gateCaught: z.number().int().nonnegative(),
    gateCaughtBeforeReviewShare: ratioSchema,
    withGeneratedVersion: z.number().int().nonnegative(),
    textChangedAfterGeneration: z.number().int().nonnegative(),
    textChangedAfterGenerationShare: ratioSchema,
    averageRating: z.number().min(1).max(5).nullable(),
    ratedArticles: z.number().int().nonnegative(),
    // Средние по рубрике редактора (7.4 дизайна): по критериям, а не только общая оценка.
    averageRubric: z.object({
      accuracy: z.number().min(1).max(5).nullable(),
      style: z.number().min(1).max(5).nullable(),
      readability: z.number().min(1).max(5).nullable(),
      hooks: z.number().min(1).max(5).nullable(),
      cliches: z.number().min(1).max(5).nullable(),
    }),
    rubricRatedArticles: z.number().int().nonnegative(),
  }),
  generation: z.object({
    runs: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    needsInput: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
    needsInputShare: ratioSchema,
    failureShare: ratioSchema,
    questions: z.array(
      z.object({
        question: z.string(),
        count: z.number().int().positive(),
      }),
    ),
    costUsd: z.number().nonnegative(),
    costPerArticle: z.number().nonnegative().nullable(),
    // Разбивка запусков по стилю материала: столбцы статусов и стоимость с задержкой.
    byStyle: z.array(
      z.object({
        styleId: z.string(),
        styleName: z.string(),
        totalRuns: z.number().int().nonnegative(),
        succeeded: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        needsInput: z.number().int().nonnegative(),
        totalCostUsd: z.number().nonnegative(),
        avgLatencyMs: z.number().nonnegative().nullable(),
      }),
    ),
    // Разбивка по версии промпта: видно, какая версия чаще даёт сбой или вопросы.
    byPromptVersion: z.array(
      z.object({
        promptVersion: z.string(),
        totalRuns: z.number().int().nonnegative(),
        succeeded: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        needsInput: z.number().int().nonnegative(),
        totalCostUsd: z.number().nonnegative(),
      }),
    ),
  }),
});
export type PilotMetricsResponse = z.infer<typeof pilotMetricsResponseSchema>;
