import type { ChecksConfig } from '@dzenwriter/shared';

export interface TextBlock {
  readonly kind: 'paragraph' | 'heading';
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

// Разбивка markdown на абзацы и заголовки. Смещения нужны, чтобы показать
// проверку в нужном месте текста.
export function splitBlocks(markdown: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  let offset = 0;
  let paragraphStart: number | null = null;
  let paragraphEnd = 0;

  const lines = markdown.split('\n');
  for (const line of lines) {
    const lineStart = offset;
    const lineEnd = offset + line.length;
    offset = lineEnd + 1;

    const isHeading = /^#{1,6}\s/.test(line);
    if (isHeading) {
      flushParagraph();
      blocks.push({ kind: 'heading', text: line, start: lineStart, end: lineEnd });
      continue;
    }
    if (line.trim().length === 0) {
      flushParagraph();
      continue;
    }
    if (paragraphStart === null) {
      paragraphStart = lineStart;
    }
    paragraphEnd = lineEnd;
  }
  flushParagraph();
  return blocks;

  function flushParagraph(): void {
    if (paragraphStart === null) {
      return;
    }
    const text = markdown.slice(paragraphStart, paragraphEnd);
    blocks.push({ kind: 'paragraph', text, start: paragraphStart, end: paragraphEnd });
    paragraphStart = null;
  }
}

// Число предложений в абзаце: точка, вопросительный или восклицательный знак.
export function countSentences(text: string): number {
  const matches = text.match(/[.!?…]+(?=\s|$)/g);
  if (matches === null) {
    return text.trim().length > 0 ? 1 : 0;
  }
  const stripped = text.replace(/[.!?…]+(?=\s|$)/g, '').trim();
  return matches.length + (stripped.length > 0 ? 1 : 0);
}

const MONTHS: Readonly<Record<string, number>> = {
  января: 1,
  феваля: 2,
  марта: 3,
  апреля: 4,
  мая: 5,
  июня: 6,
  июля: 7,
  августа: 8,
  сентября: 9,
  октября: 10,
  ноября: 11,
  декабря: 12,
  январь: 1,
  февраль: 2,
  март: 3,
  апрель: 4,
  май: 5,
  июнь: 6,
  июль: 7,
  август: 8,
  сентябрь: 9,
  октябрь: 10,
  ноябрь: 11,
  декабрь: 12,
};

const MONTH_NAMES = Object.keys(MONTHS).join('|');

// Числовая сущность в тексте: значение, формы для сравнения и место в тексте.
export interface NumberHit {
  readonly raw: string;
  readonly value: string;
  readonly forms: readonly string[];
  readonly start: number;
  readonly end: number;
  readonly kind: 'number' | 'date';
}

const DATE_ISO = /\d{4}-\d{1,2}-\d{1,2}/g;
const DATE_DOTS = /\d{1,2}[./]\d{1,2}[./]\d{2,4}/g;
const DATE_TEXT = new RegExp(`(?:\\d{1,2}\\s+(?:${MONTH_NAMES})|${MONTH_NAMES})\\s+\\d{4}`, 'gi');

// Числа в тексте: сначала даты, потом остальное. Знак процента и валюта
// не влияют на сравнение: сверяется само значение.
export function extractNumbers(text: string): NumberHit[] {
  const masked = maskDates(text);
  const hits: NumberHit[] = [];

  for (const match of masked.text.matchAll(DATE_ISO)) {
    hits.push(dateHit(masked.text, match.index ?? 0, match[0]));
  }
  for (const match of masked.text.matchAll(DATE_DOTS)) {
    hits.push(dateHit(masked.text, match.index ?? 0, match[0]));
  }
  for (const match of masked.text.matchAll(DATE_TEXT)) {
    hits.push(dateHit(masked.text, match.index ?? 0, match[0]));
  }

  const NUMBER = /\d+(?:[ \u00a0]\d{3})*(?:[.,]\d+)?/g;
  for (const match of masked.text.matchAll(NUMBER)) {
    const raw = match[0];
    const value = normalizeNumber(raw);
    hits.push({
      raw,
      value,
      forms: [value],
      start: match.index ?? 0,
      end: (match.index ?? 0) + raw.length,
      kind: 'number',
    });
  }

  return hits.sort((left, right) => left.start - right.start);
}

// 1 000 → 1000, 3,50 → 3.5. Знаки разрядов и запятая приводятся к общему виду.
export function normalizeNumber(raw: string): string {
  const cleaned = raw.replace(/[\s\u00a0]/g, '').replace(',', '.');
  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric)) {
    return cleaned;
  }
  return String(numeric);
}

// Дата раскладывается на формы: год, год с месяцем, полная дата и день с месяцем.
// Так «в 2026 году» находит дату источника, а «20 октября» — тоже.
function dateHit(text: string, start: number, raw: string): NumberHit {
  const forms = dateForms(raw);
  return {
    raw,
    value: forms[0] ?? raw,
    forms,
    start,
    end: start + raw.length,
    kind: 'date',
  };
}

export function dateForms(raw: string): string[] {
  const text = raw.trim().toLowerCase();

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) {
    return formsOf(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const dots = /^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/.exec(text);
  if (dots) {
    const year = Number(dots[3]) < 100 ? 2000 + Number(dots[3]) : Number(dots[3]);
    return formsOf(year, Number(dots[2]), Number(dots[1]));
  }

  const named = /^(?:(\d{1,2})\s+)?([а-яё]+)\s+(\d{4})$/.exec(text);
  if (named) {
    const month = MONTHS[named[2] ?? ''];
    if (month !== undefined) {
      const day = named[1] === undefined ? undefined : Number(named[1]);
      return day === undefined
        ? [`${named[3]}-${pad(month)}`, named[3] ?? '']
        : formsOf(Number(named[3]), month, day);
    }
  }

  return [text];
}

function formsOf(year: number, month: number, day: number): string[] {
  return [
    `${year}-${pad(month)}-${pad(day)}`,
    `${year}-${pad(month)}`,
    `${year}`,
    `${pad(month)}-${pad(day)}`,
  ];
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

// Даты вырезаются из текста перед поиском чисел: иначе «2026» из даты
// посчиталось бы отдельным числом.
function maskDates(text: string): { readonly text: string } {
  let masked = text.replace(DATE_ISO, (match) => ' '.repeat(match.length));
  masked = masked.replace(DATE_DOTS, (match) => ' '.repeat(match.length));
  masked = masked.replace(DATE_TEXT, (match) => ' '.repeat(match.length));
  return { text: masked };
}

// Кандидат в имя: слово с заглавной буквы, которое не выглядит обычным словом.
export interface NameHit {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

interface Word {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly sentenceStart: boolean;
}

// Имена ищутся так: слово с заглавной буквы, не из стоп-листа и не в начале
// предложения. Начало предложения пропускается намеренно: иначе каждое
// обычное слово с большой буквы считалось бы именем. Внутренняя заглавная
// буква (OpenAI) — признак имени независимо от позиции.
export function detectNames(text: string, config: ChecksConfig): NameHit[] {
  const stop = new Set(config.name_stop_words.map((word) => word.toLowerCase()));
  const words = tokenize(text);
  const hits: NameHit[] = [];

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (!word || !isCapitalized(word.text)) {
      continue;
    }
    if (stop.has(word.text.toLowerCase())) {
      continue;
    }
    if (word.sentenceStart && !hasInnerCapital(word.text)) {
      continue;
    }
    if (word.text.length < 2) {
      continue;
    }

    // Соседние кандидаты объединяются: «Европейский союз» — одно имя.
    let end = word.end;
    let last = index;
    while (last + 1 < words.length) {
      const next = words[last + 1];
      if (!next || !isCapitalized(next.text) || stop.has(next.text.toLowerCase())) {
        break;
      }
      end = next.end;
      last += 1;
    }

    hits.push({ text: text.slice(word.start, end), start: word.start, end });
    index = last;
  }

  return hits;
}

// Метки фактов в тексте — это ссылки на факты, а не имена и не числа.
// Они заменяются пробелами: длина сохраняется, поэтому смещения остаются верными.
export function maskLabels(text: string, labels: readonly string[]): string {
  let masked = text;
  for (const label of labels) {
    if (label.length === 0) {
      continue;
    }
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}])${escapeRegExp(label)}(?![\\p{L}\\p{N}])`,
      'giu',
    );
    masked = masked.replace(pattern, (match) => ' '.repeat(match.length));
  }
  return masked;
}

// Известные имена: всё, что встречается в фактах, теме, ключевых словах и продукте.
export function knownNames(sources: readonly string[]): string {
  return sources
    .filter((value) => value.length > 0)
    .join(' \n ')
    .toLowerCase();
}

export function isKnownName(name: string, corpus: string): boolean {
  return corpus.includes(name.toLowerCase());
}

function tokenize(text: string): Word[] {
  const words: Word[] = [];
  const pattern = /[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu;
  let previousEnd = -1;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    // Точка в конце слова — это знак предложения, а не часть слова.
    let length = 0;
    while (length < match[0].length && match[0][length] !== '.') {
      length += 1;
    }
    const raw = match[0].slice(0, length);
    if (raw.length === 0) {
      continue;
    }
    const end = start + raw.length;
    const between = text.slice(previousEnd + 1, start);
    const sentenceStart = previousEnd < 0 || /[.!?…:;\n]/.test(between);
    words.push({ text: raw, start, end, sentenceStart });
    previousEnd = end;
  }
  return words;
}

// Основа русского слова: отбрасываем окончание, чтобы «лучшее» и «лучшим»
// оказались одним и тем же словом.
const ENDINGS = [
  'иями',
  'ями',
  'ами',
  'его',
  'ому',
  'ыми',
  'ими',
  'иях',
  'ях',
  'ей',
  'ой',
  'ый',
  'ий',
  'ая',
  'яя',
  'ое',
  'ее',
  'ые',
  'ие',
  'ам',
  'ом',
  'ем',
  'ах',
  'ов',
  'ев',
  'ы',
  'и',
  'а',
  'я',
  'о',
  'е',
  'у',
  'ю',
  'ь',
];

export function stemOf(word: string): string {
  const lower = word.toLowerCase();
  for (const ending of ENDINGS) {
    if (lower.length - ending.length >= 3 && lower.endsWith(ending)) {
      return lower.slice(0, lower.length - ending.length);
    }
  }
  return lower;
}

// Слово есть в тексте как отдельное слово, а не как часть другого.
export function hasWholeWord(lowerText: string, word: string): boolean {
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(word)}([^\\p{L}\\p{N}]|$)`, 'iu');
  return pattern.test(lowerText);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isCapitalized(word: string): boolean {
  const first = word[0];
  if (first === undefined) {
    return false;
  }
  return first === first.toUpperCase() && first !== first.toLowerCase();
}

function hasInnerCapital(word: string): boolean {
  const rest = word.slice(1);
  return /[\p{Lu}]/u.test(rest);
}
