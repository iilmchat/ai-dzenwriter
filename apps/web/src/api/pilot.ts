import { pilotMetricsResponseSchema, type PilotMetricsResponse } from '@dzenwriter/shared';
import { apiRequest } from './client';

export interface PilotFilters {
  readonly from: string;
  readonly to: string;
}

export function fetchPilotMetrics(filters: PilotFilters): Promise<PilotMetricsResponse> {
  const params = new URLSearchParams();
  if (filters.from) {
    params.set('from', filters.from);
  }
  if (filters.to) {
    params.set('to', filters.to);
  }
  const query = params.toString();
  return apiRequest(`/api/v1/pilot/metrics${query ? `?${query}` : ''}`, {
    schema: pilotMetricsResponseSchema,
  });
}
