import {
  FACT_STATUS_LABELS,
  type FactStatus,
  type FactType,
  type UserRole,
} from '@dzenwriter/shared';

export interface FactActor {
  readonly id: string;
  readonly role: UserRole;
}

// Поля факта, которые нужны правилам. Полная запись FactView подходит целиком.
export interface FactRuleFields {
  readonly type: FactType;
  readonly status: FactStatus;
  readonly text: string;
  readonly sourceUrl: string | null;
  readonly sourcePublishedAt: string | null;
  readonly productId: string | null;
  readonly mentionsClient: boolean;
  readonly clientPermission: boolean;
  readonly consentConfirmed: boolean;
  readonly anonymized: boolean;
  readonly createdBy: { readonly id: string };
  readonly hasPendingCorrection: boolean;
}

export interface ActionCheck {
  readonly allowed: boolean;
  readonly reason: string | null;
  // Запрет из-за роли или авторства (403), а не из-за состояния факта (409).
  readonly forbidden: boolean;
}

export interface FactActionChecks {
  readonly edit: ActionCheck;
  readonly approve: ActionCheck;
  readonly reject: ActionCheck;
  readonly confirmConsent: ActionCheck;
  readonly withdrawConsent: ActionCheck;
  readonly correct: ActionCheck;
}

const ALLOWED: ActionCheck = { allowed: true, reason: null, forbidden: false };

function denied(reason: string, forbidden = false): ActionCheck {
  return { allowed: false, reason, forbidden };
}

function firstDenied(...checks: ActionCheck[]): ActionCheck {
  return checks.find((check) => !check.allowed) ?? ALLOWED;
}

function isReviewer(actor: FactActor): boolean {
  return actor.role === 'reviewer' || actor.role === 'admin';
}

function isCreator(fact: FactRuleFields, actor: FactActor): boolean {
  return fact.createdBy.id === actor.id;
}

// Автор или администратор меняет черновик. Чужие факты меняет только администратор.
function editorCheck(fact: FactRuleFields, actor: FactActor): ActionCheck {
  if (isCreator(fact, actor) || actor.role === 'admin') {
    return ALLOWED;
  }
  return denied('Менять факт может его автор или администратор', true);
}

// Одобряет и подтверждает ревьюер или администратор, но не тот, кто создал факт.
function reviewerCheck(fact: FactRuleFields, actor: FactActor): ActionCheck {
  if (!isReviewer(actor)) {
    return denied('Решение по факту принимает ревьюер или администратор', true);
  }
  if (isCreator(fact, actor)) {
    return denied('Факт не одобряет и не подтверждает тот, кто его создал', true);
  }
  return ALLOWED;
}

function draftCheck(fact: FactRuleFields): ActionCheck {
  if (fact.status === 'draft') {
    return ALLOWED;
  }
  if (fact.status === 'approved') {
    return denied('Факт уже одобрен: исправить его можно только новым фактом');
  }
  return denied(`Факт в статусе «${FACT_STATUS_LABELS[fact.status]}» больше не меняется`);
}

function typeCheck(fact: FactRuleFields, type: FactType, message: string): ActionCheck {
  return fact.type === type ? ALLOWED : denied(message);
}

// Что мешает одобрить факт. Пустой список — отметки и обязательные поля на месте.
export function approvalProblems(fact: FactRuleFields): string[] {
  const problems: string[] = [];
  if (fact.type === 'news_source') {
    if (!fact.sourceUrl) {
      problems.push('нет ссылки на источник');
    }
    if (!fact.sourcePublishedAt) {
      problems.push('нет даты публикации источника');
    }
  }
  if (fact.type === 'experience_note') {
    if (!fact.consentConfirmed) {
      problems.push('нет отметки «согласие получено»');
    }
    if (!fact.anonymized) {
      problems.push('нет отметки «текст обезличен»');
    }
  }
  if (fact.type === 'product_fact' && !fact.productId) {
    problems.push('не указан продукт');
  }
  if (fact.mentionsClient && !fact.clientPermission) {
    problems.push('в тексте назван клиент, а разрешения нет');
  }
  return problems;
}

// Доступность каждого действия по факту и пользователю. Одни и те же проверки видит сервис и UI.
export function factActions(fact: FactRuleFields, actor: FactActor): FactActionChecks {
  const problems = approvalProblems(fact);
  const withdrawnText = fact.text === '' ? denied('Согласие уже отозвано, текст удалён') : ALLOWED;
  const withdrawRole =
    isCreator(fact, actor) || isReviewer(actor)
      ? ALLOWED
      : denied('Отозвать согласие может автор заметки, ревьюер или администратор', true);

  return {
    edit: firstDenied(editorCheck(fact, actor), draftCheck(fact)),
    approve: firstDenied(
      reviewerCheck(fact, actor),
      draftCheck(fact),
      problems.length === 0 ? ALLOWED : denied(`Нельзя одобрить: ${problems.join(', ')}`),
    ),
    reject: firstDenied(reviewerCheck(fact, actor), draftCheck(fact)),
    confirmConsent: firstDenied(
      typeCheck(fact, 'experience_note', 'Согласие подтверждают у заметок опыта'),
      reviewerCheck(fact, actor),
      draftCheck(fact),
    ),
    withdrawConsent: firstDenied(
      typeCheck(fact, 'experience_note', 'Отзыв согласия относится только к заметкам опыта'),
      withdrawRole,
      withdrawnText,
    ),
    correct: firstDenied(
      fact.status === 'approved' ? ALLOWED : denied('Исправить можно только одобренный факт'),
      fact.hasPendingCorrection ? denied('Исправление уже на проверке') : ALLOWED,
    ),
  };
}
