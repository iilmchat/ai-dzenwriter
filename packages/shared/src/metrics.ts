import { z } from 'zod';
import { METRIC_SOURCES } from './enums';

// Снимок метрик публикации на дату. Значения накопительные: столько просмотров
// и чтений было у статьи на момент снятия снимка.
export const metricSnapshotSchema = z.object({
  id: z.uuid(),
  articleId: z.uuid(),
  topic: z.string(),
  externalUrl: z.string().nullable(),
  capturedOn: z.iso.date(),
  views: z.number().int().nonnegative(),
  reads: z.number().int().nonnegative(),
  avgReadSeconds: z.number().int().nonnegative().nullable(),
  source: z.enum(METRIC_SOURCES),
  createdAt: z.iso.datetime(),
  createdBy: z.string(),
});
export type MetricSnapshot = z.infer<typeof metricSnapshotSchema>;

export const metricListResponseSchema = z.object({
  items: z.array(metricSnapshotSchema),
});
export type MetricListResponse = z.infer<typeof metricListResponseSchema>;

// Ручной ввод: автор вносит цифры из панели Дзена на дату.
export const createMetricInputSchema = z.object({
  articleId: z.uuid({ error: 'Выберите материал' }),
  capturedOn: z.iso.date({ error: 'Некорректная дата' }),
  views: z.number().int().nonnegative({ error: 'Просмотры — целое число' }),
  reads: z.number().int().nonnegative({ error: 'Прочтения — целое число' }),
  avgReadSeconds: z.number().int().nonnegative().nullable().optional(),
});
export type CreateMetricInput = z.infer<typeof createMetricInputSchema>;

export const createMetricResponseSchema = z.object({
  snapshot: metricSnapshotSchema,
});
export type CreateMetricResponse = z.infer<typeof createMetricResponseSchema>;

// Импорт CSV: текст файла целиком, разбор на сервере.
export const importMetricsInputSchema = z.object({
  csv: z.string().min(1, 'Пустой файл'),
});
export type ImportMetricsInput = z.infer<typeof importMetricsInputSchema>;

export const importMetricsResponseSchema = z.object({
  imported: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.array(
    z.object({
      line: z.number().int(),
      reason: z.string(),
    }),
  ),
});
export type ImportMetricsResponse = z.infer<typeof importMetricsResponseSchema>;

// Колонки CSV: канонические имена и русские синонимы.
export const METRIC_CSV_COLUMNS = {
  url: ['url', 'ссылка'],
  capturedOn: ['captured_on', 'date', 'дата'],
  views: ['views', 'просмотры'],
  reads: ['reads', 'прочтения'],
  avgReadSeconds: ['avg_read_seconds', 'avg_read', 'время чтения'],
} as const;
