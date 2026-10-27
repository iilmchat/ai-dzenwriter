import { createHash } from 'node:crypto';
import {
  FACT_POLICY_LABELS,
  FACT_TYPE_LABELS,
  type ArticleFormat,
  type FactType,
  type FormatConfig,
  type StyleConfig,
  type Tone,
} from '@dzenwriter/shared';

export interface PromptFact {
  readonly factId: string;
  readonly label: string;
  readonly type: FactType;
  readonly text: string;
  readonly sourceName: string | null;
  readonly sourceUrl: string | null;
  readonly sourcePublishedAt: string | null;
}

export interface BuildPromptInput {
  // Базовый промпт из prompts/dzen_writer.md с подстановками вида {{style_id}}.
  readonly basePrompt: string;
  readonly style: StyleConfig;
  readonly format: FormatConfig;
  readonly formatId: ArticleFormat;
  readonly topic: string;
  readonly keywords: readonly string[];
  readonly tone: Tone;
  readonly lengthMin: number;
  readonly lengthMax: number;
  readonly productName: string | null;
  // В модель идут только одобренные факты: заметки опыта к этому моменту уже обезличены.
  readonly facts: readonly PromptFact[];
  readonly today: string;
}

export interface BuiltPrompt {
  readonly text: string;
  // Версия промпта и конфигурации: по ней видно, какими правилами собрался текст.
  readonly promptVersion: string;
  // SHA-256 собранного промпта: попадает в input_snapshot запуска.
  readonly sha256: string;
}

// Подстановки одним проходом: так значения, содержащие {{...}}, не разворачиваются дважды.
const PLACEHOLDER = /\{\{(\w+)\}\}/g;

// Набивка шаблона значениями. Неизвестную подстановку оставляем как есть:
// видно, что шаблон разошёлся с кодом.
export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(PLACEHOLDER, (match, key: string) => {
    const value = values[key];
    return value === undefined ? match : value;
  });
}

export function buildPrompt(input: BuildPromptInput): BuiltPrompt {
  const values: Record<string, string> = {
    style_id: input.style.id,
    style_name: input.style.name,
    format_name: input.format.name,
    topic: input.topic,
    keywords: input.keywords.length > 0 ? input.keywords.join(', ') : 'не заданы',
    tone: input.tone,
    length_min: String(input.lengthMin),
    length_max: String(input.lengthMax),
    product_name: input.productName ?? 'не указан',
    today: input.today,
    facts: renderFacts(input.facts),
    style_instructions: input.style.instructions.trim(),
    fact_policy_text: FACT_POLICY_LABELS[input.style.fact_policy],
    format_structure: input.format.structure,
    disclaimer_text: input.style.disclaimer.text,
  };

  const text = renderTemplate(input.basePrompt, values);

  return {
    text,
    promptVersion: promptVersion(input),
    sha256: sha256(text),
  };
}

export interface BuildExpandPromptInput {
  // Промпт доведения объёма из prompts/dzen_expand.md.
  readonly expandPrompt: string;
  readonly format: FormatConfig;
  readonly topic: string;
  readonly title: string;
  // Текст первой версии, который нужно разворачивать.
  readonly markdown: string;
  readonly facts: readonly PromptFact[];
}

// Промпт второго прохода. Цель — нижняя граница формата плюс 20%,
// округлённая до сотен: чтобы модель перепрыгнула границу, а не остановилась на ней.
export function buildExpandPrompt(input: BuildExpandPromptInput): string {
  const minChars = input.format.length.min;
  const targetChars = Math.round((minChars * 1.2) / 100) * 100;
  const values: Record<string, string> = {
    format_name: input.format.name,
    format_structure: input.format.structure,
    topic: input.topic,
    title: input.title,
    current_chars: String(input.markdown.length),
    min_chars: String(minChars),
    target_chars: String(targetChars),
    length_max: String(input.format.length.max),
    facts: renderFacts(input.facts),
    article_markdown: input.markdown,
  };
  return renderTemplate(input.expandPrompt, values);
}

// Факты идут как данные с метками: модель ссылается на них в claims по этим меткам.
export function renderFacts(facts: readonly PromptFact[]): string {
  if (facts.length === 0) {
    return '(одобренных фактов нет)';
  }
  return facts.map((fact) => renderFact(fact)).join('\n\n');
}

function renderFact(fact: PromptFact): string {
  const lines = [`${fact.label} [${FACT_TYPE_LABELS[fact.type]}]`, `Текст: ${fact.text}`];
  const source = describeSource(fact);
  if (source !== null) {
    lines.push(`Источник: ${source}`);
  }
  return lines.join('\n');
}

function describeSource(fact: PromptFact): string | null {
  const parts: string[] = [];
  if (fact.sourceName !== null && fact.sourceName.length > 0) {
    parts.push(fact.sourceName);
  }
  if (fact.sourcePublishedAt !== null && fact.sourcePublishedAt.length > 0) {
    parts.push(fact.sourcePublishedAt);
  }
  if (fact.sourceUrl !== null && fact.sourceUrl.length > 0) {
    parts.push(fact.sourceUrl);
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

// Версия промпта и конфигурации: базовый промпт, стиль и формат.
function promptVersion(input: BuildPromptInput): string {
  const source = [
    input.basePrompt,
    `${input.style.id}@${input.style.version}`,
    input.formatId,
  ].join('\n');
  return `sha256:${sha256(source).slice(0, 16)}`;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
