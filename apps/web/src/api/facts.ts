import {
  factItemSchema,
  factListResponseSchema,
  factUsageResponseSchema,
  type CreateFactInput,
  type FactFields,
  type FactItem,
  type FactListQuery,
  type FactListResponse,
  type FactUsageResponse,
  type UpdateFactInput,
} from '@dzenwriter/shared';
import { apiRequest } from './client';

export function fetchFacts(query: FactListQuery = {}): Promise<FactListResponse> {
  const params = new URLSearchParams();
  if (query.type) {
    params.set('type', query.type);
  }
  if (query.status) {
    params.set('status', query.status);
  }
  if (query.productId) {
    params.set('productId', query.productId);
  }
  if (query.q) {
    params.set('q', query.q);
  }
  const search = params.toString();
  return apiRequest(`/api/v1/facts${search ? `?${search}` : ''}`, {
    schema: factListResponseSchema,
  });
}

export function createFact(input: CreateFactInput): Promise<FactItem> {
  return apiRequest('/api/v1/facts', { method: 'POST', body: input, schema: factItemSchema });
}

export function updateFact(id: string, input: UpdateFactInput): Promise<FactItem> {
  return apiRequest(`/api/v1/facts/${id}`, {
    method: 'PATCH',
    body: input,
    schema: factItemSchema,
  });
}

// Действия над фактом принимают версию, которую пользователь видел.
export function approveFact(id: string, expectedVersion: number): Promise<FactItem> {
  return factAction(id, 'approve', { expectedVersion });
}

export function rejectFact(id: string, expectedVersion: number): Promise<FactItem> {
  return factAction(id, 'reject', { expectedVersion });
}

export function confirmConsent(
  id: string,
  expectedVersion: number,
  anonymized: boolean,
): Promise<FactItem> {
  return factAction(id, 'consent', { expectedVersion, anonymized });
}

export function withdrawConsent(id: string, expectedVersion: number): Promise<FactItem> {
  return factAction(id, 'consent/withdraw', { expectedVersion });
}

export function correctFact(id: string, input: FactFields): Promise<FactItem> {
  return apiRequest(`/api/v1/facts/${id}/corrections`, {
    method: 'POST',
    body: input,
    schema: factItemSchema,
  });
}

// Где факт используется: материалы, к которым он привязан.
export function fetchFactUsage(id: string): Promise<FactUsageResponse> {
  return apiRequest(`/api/v1/facts/${id}/usage`, { schema: factUsageResponseSchema });
}

function factAction(id: string, action: string, body: unknown): Promise<FactItem> {
  return apiRequest(`/api/v1/facts/${id}/${action}`, {
    method: 'POST',
    body,
    schema: factItemSchema,
  });
}
