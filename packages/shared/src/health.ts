import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const readinessResponseSchema = z.object({
  status: z.enum(['ready', 'unavailable']),
  checks: z.object({
    database: z.enum(['ok', 'error']),
  }),
});
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
