import type { AuditListResponse, AuditQuery } from '@dzenwriter/shared';
import { auditListResponseSchema } from '@dzenwriter/shared';
import { apiRequest } from './client';

export function fetchAudit(query: AuditQuery): Promise<AuditListResponse> {
  const params = new URLSearchParams();
  if (query.actorId !== undefined) {
    params.set('actorId', query.actorId);
  }
  if (query.action !== undefined) {
    params.set('action', query.action);
  }
  if (query.entityType !== undefined) {
    params.set('entityType', query.entityType);
  }
  if (query.from !== undefined) {
    params.set('from', query.from);
  }
  if (query.to !== undefined) {
    params.set('to', query.to);
  }
  const search = params.toString();
  return apiRequest(`/api/v1/audit${search.length > 0 ? `?${search}` : ''}`, {
    schema: auditListResponseSchema,
  });
}
