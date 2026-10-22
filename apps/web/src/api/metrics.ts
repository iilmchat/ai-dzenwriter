import {
  createMetricResponseSchema,
  importMetricsResponseSchema,
  metricListResponseSchema,
  type CreateMetricInput,
  type CreateMetricResponse,
  type ImportMetricsResponse,
  type MetricListResponse,
} from '@dzenwriter/shared';
import { apiRequest } from './client';

export function fetchMetrics(articleId?: string): Promise<MetricListResponse> {
  const query = articleId === undefined ? '' : `?articleId=${encodeURIComponent(articleId)}`;
  return apiRequest(`/api/v1/metrics${query}`, {
    schema: metricListResponseSchema,
  });
}

export function createMetric(input: CreateMetricInput): Promise<CreateMetricResponse> {
  return apiRequest('/api/v1/metrics', {
    method: 'POST',
    body: input,
    schema: createMetricResponseSchema,
  });
}

export function importMetrics(csv: string): Promise<ImportMetricsResponse> {
  return apiRequest('/api/v1/metrics/import', {
    method: 'POST',
    body: { csv },
    schema: importMetricsResponseSchema,
  });
}
