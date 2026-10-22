import type { FactItem } from '@dzenwriter/shared';
import { factActions, type ActionCheck, type FactActor } from './fact-rules';
import type { FactView } from './facts.repository';

export function toFactItem(view: FactView, actor: FactActor): FactItem {
  const actions = factActions(view, actor);
  return {
    id: view.id,
    type: view.type,
    status: view.status,
    text: view.text,
    sourceName: view.sourceName,
    sourceUrl: view.sourceUrl,
    sourcePublishedAt: view.sourcePublishedAt,
    productId: view.productId,
    productName: view.productName,
    mentionsClient: view.mentionsClient,
    clientPermission: view.clientPermission,
    consentConfirmed: view.consentConfirmed,
    consentConfirmedBy: view.consentConfirmedBy?.login ?? null,
    consentConfirmedAt: view.consentConfirmedAt?.toISOString() ?? null,
    anonymized: view.anonymized,
    createdBy: view.createdBy,
    approvedBy: view.approvedBy,
    approvedAt: view.approvedAt?.toISOString() ?? null,
    supersedesId: view.supersedesId,
    supersededById: view.supersededById,
    hasPendingCorrection: view.hasPendingCorrection,
    version: view.version,
    createdAt: view.createdAt.toISOString(),
    updatedAt: view.updatedAt.toISOString(),
    actions: {
      edit: toActionState(actions.edit),
      approve: toActionState(actions.approve),
      reject: toActionState(actions.reject),
      confirmConsent: toActionState(actions.confirmConsent),
      withdrawConsent: toActionState(actions.withdrawConsent),
      correct: toActionState(actions.correct),
    },
  };
}

function toActionState(check: ActionCheck): { allowed: boolean; reason: string | null } {
  return { allowed: check.allowed, reason: check.reason };
}
