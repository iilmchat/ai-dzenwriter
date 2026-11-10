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

export interface MetricsFilters {
  readonly from?: string;
  readonly to?: string;
  readonly publicationIds?: readonly string[];
}

export type MetricsResponse = MetricListResponse;

export function fetchMetrics(filters: MetricsFilters = {}): Promise<MetricsResponse> {
  const params = new URLSearchParams();
  if (filters.from) {
    params.set('from', filters.from);
  }
  if (filters.to) {
    params.set('to', filters.to);
  }
  if (filters.publicationIds !== undefined && filters.publicationIds.length > 0) {
    params.set('publicationIds', filters.publicationIds.join(','));
  }
  const query = params.toString();
  return apiRequest(`/api/v1/metrics${query ? `?${query}` : ''}`, {
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
