import {
  CONTENT_EDITABLE_STATUSES,
  type ArticleStatus,
  type CheckSeverity,
  type FactStatus,
  type FactType,
  ARTICLE_STATUS_LABELS,
  FACT_STATUS_LABELS,
  FACT_TYPE_LABELS,
  FACT_TYPES,
  type FormatConfig,
  type StyleConfig,
  type TransitionOption,
  type UserRole,
} from '@dzenwriter/shared';

export const STATUS_LABELS = ARTICLE_STATUS_LABELS;

export const OUT_OF_FOCUS_WARNING =
  'Тема вне фокуса ИИ. Запуск генерации потребует подтверждения ревьюера.';

// Текст и параметры меняются только до утверждения. Дальше материал возвращается в черновик.
export const EDITABLE_CONTENT_STATUSES: ReadonlySet<ArticleStatus> = new Set(
  CONTENT_EDITABLE_STATUSES,
);

export type ActorKind = 'author' | 'reviewer' | 'author_or_reviewer';
export type GateKind = 'inputs' | 'reviewable' | 'planned';

export interface TransitionRule {
  readonly from: ArticleStatus;
  readonly to: ArticleStatus;
  readonly actor: ActorKind;
  readonly gate?: GateKind;
  readonly needsComment?: boolean;
  readonly needsUrl?: boolean;
  readonly decision?: 'approved' | 'changes_requested';
  readonly archives?: boolean;
}

// Переходы из раздела 5 дизайна. Условия из колонки «Условие» проверяются через gate.
export const TRANSITIONS: readonly TransitionRule[] = [
  { from: 'idea', to: 'researching', actor: 'author' },
  { from: 'researching', to: 'drafting', actor: 'author', gate: 'inputs' },
  { from: 'drafting', to: 'in_review', actor: 'author', gate: 'reviewable' },
  {
    from: 'in_review',
    to: 'drafting',
    actor: 'reviewer',
    needsComment: true,
    decision: 'changes_requested',
  },
  {
    from: 'in_review',
    to: 'approved',
    actor: 'reviewer',
    gate: 'reviewable',
    decision: 'approved',
  },
  { from: 'approved', to: 'drafting', actor: 'author' },
  { from: 'approved', to: 'scheduled', actor: 'author', gate: 'planned' },
  { from: 'approved', to: 'published', actor: 'author_or_reviewer', needsUrl: true },
  { from: 'scheduled', to: 'published', actor: 'author_or_reviewer', needsUrl: true },
  { from: 'idea', to: 'archived', actor: 'author', archives: true },
  { from: 'researching', to: 'archived', actor: 'author', archives: true },
  { from: 'drafting', to: 'archived', actor: 'author', archives: true },
  { from: 'approved', to: 'archived', actor: 'author', archives: true },
];

export function transitionsFrom(status: ArticleStatus): TransitionRule[] {
  return TRANSITIONS.filter((rule) => rule.from === status);
}

export function findTransition(from: ArticleStatus, to: ArticleStatus): TransitionRule | undefined {
  return TRANSITIONS.find((rule) => rule.from === from && rule.to === to);
}

export interface Actor {
  readonly id: string;
  readonly role: UserRole;
}

// Автор — владелец материала или администратор. Ревьюер — роль ревьюера или администратор,
// но не автор: ревьюер не утверждает собственный материал.
export function permissionProblem(
  rule: TransitionRule,
  actor: Actor,
  ownerId: string,
): string | null {
  const isOwner = actor.id === ownerId;
  const isAdmin = actor.role === 'admin';
  if (rule.actor === 'author') {
    return isOwner || isAdmin ? null : 'Перевести материал может его автор или администратор';
  }
  if (rule.actor === 'reviewer') {
    if (isOwner) {
      return 'Ревьюер не утверждает и не возвращает собственный материал';
    }
    return actor.role === 'reviewer' || isAdmin ? null : 'Решение по материалу принимает ревьюер';
  }
  if (isOwner || isAdmin || actor.role === 'reviewer') {
    return null;
  }
  return 'Отметить публикацию может автор или ревьюер';
}

export interface VersionCheck {
  readonly id: string;
  readonly severity: CheckSeverity;
  readonly message?: string;
}

export interface VersionInfo {
  readonly number: number;
  readonly advertisingLabel: boolean;
  readonly checks: readonly VersionCheck[];
}

export type FactTotals = Readonly<
  Record<FactType, { readonly count: number; readonly chars: number }>
>;

export interface FactLinkStatus {
  readonly label: string;
  readonly status: FactStatus;
}

export interface GateContext {
  readonly style: StyleConfig | undefined;
  readonly productId: string | null;
  readonly plannedAt: Date | null;
  readonly totals: FactTotals;
  readonly latest: VersionInfo | undefined;
  readonly links: readonly FactLinkStatus[];
}

export interface RequirementResult {
  readonly title: string;
  readonly required: number;
  readonly actual: number;
  readonly met: boolean;
}

// Что нужно стилю, чтобы перейти от фактов к черновику. Считаются только одобренные факты.
export function inputRequirements(
  style: StyleConfig,
  totals: FactTotals,
  productId: string | null,
): RequirementResult[] {
  const { inputs } = style;
  const approved = inputs.required_fact_types.reduce((sum, type) => sum + totals[type].count, 0);
  const results: RequirementResult[] = [
    {
      title: `Одобренные факты: ${inputs.required_fact_types.map((type) => FACT_TYPE_LABELS[type]).join(', ')}`,
      required: inputs.min_facts,
      actual: approved,
      met: approved >= inputs.min_facts,
    },
  ];
  if (inputs.requires_product) {
    results.push({
      title: 'Продукт',
      required: 1,
      actual: productId === null ? 0 : 1,
      met: productId !== null,
    });
  }
  if (inputs.min_note_chars !== undefined) {
    const chars = totals.experience_note.chars;
    results.push({
      title: 'Заметки опыта, знаков',
      required: inputs.min_note_chars,
      actual: chars,
      met: chars >= inputs.min_note_chars,
    });
  }
  return results;
}

// Причины, по которым переход нельзя выполнить. Пустой список — условия выполнены.
export function gateProblems(rule: TransitionRule, context: GateContext): string[] {
  if (rule.gate === 'inputs') {
    if (!context.style) {
      return ['Стиль материала не найден в конфигурации'];
    }
    return inputRequirements(context.style, context.totals, context.productId)
      .filter((item) => !item.met)
      .map((item) => `Не хватает: ${item.title}, ${item.actual} из ${item.required}`);
  }
  if (rule.gate === 'reviewable') {
    return reviewProblems(context);
  }
  if (rule.gate === 'planned' && context.plannedAt === null) {
    return ['Назначьте плановую дату публикации, прежде чем ставить материал в график'];
  }
  return [];
}

function reviewProblems(context: GateContext): string[] {
  const { latest, style, productId } = context;
  const problems = unapprovedLinkProblems(context.links);
  if (!latest) {
    return [...problems, 'Нет версии текста: её создаёт генерация или ручная правка'];
  }
  const blocking = countBlockingChecks(latest.checks);
  if (blocking > 0) {
    problems.push(`В версии ${latest.number} блокирующих проверок: ${blocking}`);
  }
  if (
    productId !== null &&
    style?.checks.ad_disclosure_required === 'block' &&
    !latest.advertisingLabel
  ) {
    problems.push(`В версии ${latest.number} нет маркировки рекламы`);
  }
  return problems;
}

// Материал опирается только на одобренные факты: привязанный черновик или заменённый факт
// не даёт пройти на ревью, пока автор не уберёт его или не привяжет одобренную замену.
function unapprovedLinkProblems(links: readonly FactLinkStatus[]): string[] {
  const pending = links.filter((link) => link.status !== 'approved');
  if (pending.length === 0) {
    return [];
  }
  const list = pending
    .map((link) => `${link.label} (${FACT_STATUS_LABELS[link.status].toLowerCase()})`)
    .join(', ');
  return [`Привязанные факты не одобрены: ${list}`];
}

export function countBlockingChecks(checks: readonly VersionCheck[]): number {
  return checks.filter((check) => check.severity === 'block').length;
}

export function describeTransition(
  rule: TransitionRule,
  actor: Actor,
  ownerId: string,
  context: GateContext,
): TransitionOption {
  const denied = permissionProblem(rule, actor, ownerId);
  const reasons = denied === null ? gateProblems(rule, context) : [denied];
  return {
    to: rule.to,
    allowed: reasons.length === 0,
    reason: reasons.length > 0 ? reasons.join('; ') : null,
    needsComment: rule.needsComment === true,
    needsUrl: rule.needsUrl === true,
  };
}

// Слова-признаки темы про ИИ. Проверка подсказывает автору, а не блокирует создание.
const AI_FOCUS =
  /(?:^|[^\p{L}\p{N}])(?:ии|ai|llm|gpt|rag|нейросет\p{L}*|агент\p{L}*|модел\p{L}*|промпт\p{L}*|искусственн\p{L}*)(?=$|[^\p{L}\p{N}])/iu;

export function isInAiFocus(topic: string, keywords: readonly string[]): boolean {
  return AI_FOCUS.test([topic, ...keywords].join(' '));
}

export function lengthWarnings(
  format: FormatConfig,
  lengthMin: number,
  lengthMax: number,
): string[] {
  if (lengthMin >= format.length.min && lengthMax <= format.length.max) {
    return [];
  }
  return [
    `Объём ${lengthMin}–${lengthMax} знаков вне диапазона формата «${format.name}»: ${format.length.min}–${format.length.max}`,
  ];
}

export function emptyFactTotals(): Record<FactType, { count: number; chars: number }> {
  return Object.fromEntries(FACT_TYPES.map((type) => [type, { count: 0, chars: 0 }])) as Record<
    FactType,
    { count: number; chars: number }
  >;
}
