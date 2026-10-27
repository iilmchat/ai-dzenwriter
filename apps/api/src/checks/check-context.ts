import type {
  ChecksConfig,
  FactStatus,
  FactType,
  FormatConfig,
  StyleConfig,
  VersionClaim,
  VersionCheck,
} from '@dzenwriter/shared';
import {
  corpusNameStems,
  detectNames,
  extractNumbers,
  knownNames,
  maskLabels,
  splitBlocks,
  type NameHit,
  type NumberHit,
  type TextBlock,
} from './text-analysis';

// Факт, доступный проверкам. Тексты фактов нужны проверкам, но в журнал и
// в снимок запуска они не попадают.
export interface CheckFact {
  readonly label: string;
  readonly id: string;
  readonly type: FactType;
  readonly status: FactStatus;
  readonly text: string;
  readonly sourceName: string | null;
  readonly sourceUrl: string | null;
  readonly sourcePublishedAt: string | null;
  readonly mentionsClient: boolean;
  readonly clientPermission: boolean;
}

// Утверждение в том виде, в котором его хранит версия: текст, тип и метки фактов.
export interface CheckClaim {
  readonly text: string;
  readonly type: 'fact' | 'hypothesis' | 'opinion';
  readonly factIds: readonly string[];
}

export interface CheckInput {
  readonly style: StyleConfig;
  readonly format: FormatConfig;
  readonly topic: string;
  readonly keywords: readonly string[];
  readonly productName: string | null;
  readonly facts: readonly CheckFact[];
  readonly title: string;
  readonly seoTitle: string;
  readonly tags: readonly string[];
  readonly articleMarkdown: string;
  readonly advertisingLabel: boolean;
  readonly disclaimerText: string | null;
  // Утверждения из ответа модели или из редактора: их проверяет claims_need_fact_ids.
  readonly claims: readonly CheckClaim[];
  // Метки фактов, которые получила модель: F1, F2 и так далее.
  readonly factLabels: readonly string[];
  readonly config: ChecksConfig;
}

// Данные, посчитанные один раз и общие для всех проверок.
export interface CheckContext {
  readonly input: CheckInput;
  readonly blocks: readonly TextBlock[];
  readonly paragraphs: readonly TextBlock[];
  readonly numbers: readonly NumberHit[];
  readonly names: readonly NameHit[];
  // Одобренные факты: модель видела только их, поэтому сверяемся с ними.
  readonly facts: readonly CheckFact[];
  // Все привязанные факты: по ним проверяется, например, дата источника.
  readonly linkedFacts: readonly CheckFact[];
  // Формы чисел из фактов и темы: с ними сверяются числа текста.
  readonly factNumberForms: ReadonlySet<string>;
  // Текст, по которому ищутся имена: факты, тема, ключевые слова, продукт.
  readonly nameCorpus: string;
  // Основы слов того же корпуса: морфология имён сверяется по ним.
  readonly nameStems: ReadonlySet<string>;
  // То же, но без фактов: для личного опыта имена в фактах не считаются разрешением.
  readonly topicCorpus: string;
  readonly factLabels: ReadonlySet<string>;
  readonly textLength: number;
}

export function buildContext(input: CheckInput): CheckContext {
  const blocks = splitBlocks(input.articleMarkdown);
  const paragraphs = blocks.filter((block) => block.kind === 'paragraph');
  // Метки фактов в тексте — ссылки на факты, а не имена и числа.
  const maskedText = maskLabels(input.articleMarkdown, input.factLabels);
  const numbers = extractNumbers(maskedText);
  const names = detectNames(maskedText, input.config);

  const facts = input.facts.filter((fact) => fact.status === 'approved');
  const factSources = facts.map((fact) => fact.text);
  const topicSources = [input.topic, ...input.keywords];
  const productSources = input.productName === null ? [] : [input.productName];
  const nameCorpus = knownNames([...factSources, ...topicSources, ...productSources]);

  const factNumberForms = new Set<string>();
  for (const source of [...factSources, ...topicSources, ...productSources]) {
    for (const hit of extractNumbers(source)) {
      for (const form of hit.forms) {
        factNumberForms.add(form);
      }
    }
  }
  for (const fact of facts) {
    if (fact.sourcePublishedAt !== null) {
      for (const form of dateFormsOf(fact.sourcePublishedAt)) {
        factNumberForms.add(form);
      }
    }
  }

  return {
    input,
    blocks,
    paragraphs,
    numbers,
    names,
    facts,
    linkedFacts: input.facts,
    factNumberForms,
    nameCorpus,
    nameStems: corpusNameStems(nameCorpus),
    topicCorpus: knownNames([...topicSources, ...productSources]),
    factLabels: new Set(input.factLabels),
    textLength: input.articleMarkdown.trim().length,
  };
}

// Формы даты из поля источника: тот же набор, что и у даты в тексте.
function dateFormsOf(value: string): string[] {
  const parts = value.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return [value];
  }
  const pad = (part: number): string => (part < 10 ? `0${part}` : String(part));
  return [
    `${year}-${pad(month)}-${pad(day)}`,
    `${year}-${pad(month)}`,
    `${year}`,
    `${pad(month)}-${pad(day)}`,
  ];
}

// Утверждение с его местом в тексте: так редактор сможет подсветить фрагмент.
export function locateClaims(claims: readonly CheckClaim[], markdown: string): VersionClaim[] {
  return claims.map((claim) => {
    const position = findText(markdown, claim.text);
    return {
      text: claim.text,
      type: claim.type,
      factIds: [...claim.factIds],
      ...(position === null ? {} : { start: position.start, end: position.end }),
    };
  });
}

// Ищет фрагмент в тексте с начала: порядок утверждений обычно совпадает с порядком в тексте.
function findText(markdown: string, needle: string): { start: number; end: number } | null {
  const trimmed = needle.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const index = markdown.indexOf(trimmed);
  if (index < 0) {
    return null;
  }
  return { start: index, end: index + trimmed.length };
}

export function check(
  id: string,
  severity: VersionCheck['severity'],
  message: string,
  position?: { readonly start: number; readonly end: number; readonly excerpt: string },
): VersionCheck {
  return {
    id,
    severity,
    message,
    ...(position === undefined
      ? {}
      : { start: position.start, end: position.end, excerpt: position.excerpt }),
  };
}
