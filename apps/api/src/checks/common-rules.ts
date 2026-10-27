import type { VersionCheck } from '@dzenwriter/shared';
import { check, type CheckContext } from './check-context';
import { requiredDisclaimer } from './disclaimer';

// Общие проверки для всех стилей: уровень задан правилами движка, стилем они не настраиваются.
export function runCommonChecks(context: CheckContext): VersionCheck[] {
  return [
    ...checkDisclaimer(context),
    ...checkTitleLength(context),
    ...checkSeoTitleLength(context),
    ...checkTagsCount(context),
    ...checkLengthInRange(context),
    ...checkBannedPhrases(context),
    ...checkClickbait(context),
    ...checkHooks(context),
    ...checkParagraphLength(context),
  ];
}

const TITLE_MAX = 80;
const SEO_TITLE_MAX = 70;
const TAGS_MIN = 5;
const TAGS_MAX = 7;
const SENTENCES_PER_PARAGRAPH = 4;
const PARAGRAPHS_PER_HOOK = 3;

// Тема медицинская, юридическая или финансовая — нужен дисклеймер.
function checkDisclaimer(context: CheckContext): VersionCheck[] {
  const { input } = context;
  const required = requiredDisclaimer({
    style: input.style,
    topic: input.topic,
    keywords: input.keywords,
    config: input.config,
  });
  if (required === null) {
    return [];
  }
  const text = input.articleMarkdown.toLowerCase();
  const disclaimer = required.trim().toLowerCase();
  if (disclaimer.length > 0 && text.includes(disclaimer)) {
    return [];
  }
  return [
    check(
      'disclaimer_required',
      'block',
      `В тексте нет оговорки: «${input.style.disclaimer.text}»`,
    ),
  ];
}

function checkTitleLength(context: CheckContext): VersionCheck[] {
  const length = context.input.title.trim().length;
  if (length <= TITLE_MAX) {
    return [];
  }
  return [check('title_length', 'block', `Заголовок длиннее ${TITLE_MAX} знаков: ${length}`)];
}

function checkSeoTitleLength(context: CheckContext): VersionCheck[] {
  const length = context.input.seoTitle.trim().length;
  if (length <= SEO_TITLE_MAX) {
    return [];
  }
  return [
    check('seo_title_length', 'block', `SEO-заголовок длиннее ${SEO_TITLE_MAX} знаков: ${length}`),
  ];
}

function checkTagsCount(context: CheckContext): VersionCheck[] {
  const count = context.input.tags.length;
  if (count >= TAGS_MIN && count <= TAGS_MAX) {
    return [];
  }
  return [check('tags_count', 'block', `Тегов ${count}, а нужно ${TAGS_MIN}–${TAGS_MAX}`)];
}

function checkLengthInRange(context: CheckContext): VersionCheck[] {
  const { format } = context.input;
  const length = context.textLength;
  if (length >= format.length.min && length <= format.length.max) {
    return [];
  }
  return [
    check(
      'length_in_range',
      'warn',
      `Объём ${length} знаков вне диапазона формата «${format.name}»: ${format.length.min}–${format.length.max}`,
    ),
  ];
}

function checkBannedPhrases(context: CheckContext): VersionCheck[] {
  return findPhrases(
    context,
    context.input.config.banned_phrases,
    'banned_phrases',
    'warn',
    'штамп',
  );
}

function checkClickbait(context: CheckContext): VersionCheck[] {
  return findPhrases(
    context,
    context.input.config.clickbait_phrases,
    'clickbait_phrases',
    'warn',
    'кликбейт',
  );
}

// Штампы и кликбейт ищутся как подстроки: фраза может быть частью предложения.
function findPhrases(
  context: CheckContext,
  phrases: readonly string[],
  id: string,
  severity: VersionCheck['severity'],
  label: string,
): VersionCheck[] {
  const results: VersionCheck[] = [];
  const lower = context.input.articleMarkdown.toLowerCase();
  for (const phrase of phrases) {
    const needle = phrase.toLowerCase();
    const index = lower.indexOf(needle);
    if (index < 0) {
      continue;
    }
    results.push(
      check(id, severity, `«${phrase}» — ${label}`, {
        start: index,
        end: index + phrase.length,
        excerpt: phrase,
      }),
    );
  }
  return results;
}

// Крючок: вопрос или абзац, который начинается с маркера из конфигурации.
function checkHooks(context: CheckContext): VersionCheck[] {
  const results: VersionCheck[] = [];
  const paragraphs = context.paragraphs;
  const markers = context.input.config.hook_markers.map((marker) => marker.toLowerCase());

  for (
    let index = 0;
    index + PARAGRAPHS_PER_HOOK <= paragraphs.length;
    index += PARAGRAPHS_PER_HOOK
  ) {
    const chunk = paragraphs.slice(index, index + PARAGRAPHS_PER_HOOK);
    const hasHook = chunk.some((paragraph) => isHook(paragraph.text, markers));
    if (hasHook) {
      continue;
    }
    const first = chunk[0];
    if (!first) {
      continue;
    }
    results.push(
      check(
        'hook_every_3_paragraphs',
        'info',
        `В абзацах ${index + 1}–${index + PARAGRAPHS_PER_HOOK} нет крючка`,
        { start: first.start, end: first.end, excerpt: first.text.slice(0, 80) },
      ),
    );
  }
  return results;
}

function isHook(text: string, markers: readonly string[]): boolean {
  if (text.includes('?')) {
    return true;
  }
  const lower = text.trim().toLowerCase();
  return markers.some((marker) => lower.startsWith(marker));
}

function checkParagraphLength(context: CheckContext): VersionCheck[] {
  const results: VersionCheck[] = [];
  for (const paragraph of context.paragraphs) {
    const sentences = countSentences(paragraph.text);
    if (sentences <= SENTENCES_PER_PARAGRAPH) {
      continue;
    }
    results.push(
      check('paragraph_length', 'info', `В абзаце ${sentences} предложений`, {
        start: paragraph.start,
        end: paragraph.end,
        excerpt: paragraph.text.slice(0, 80),
      }),
    );
  }
  return results;
}

// Абзац длиннее четырёх предложений читается тяжело.
function countSentences(text: string): number {
  const matches = text.match(/[.!?…]+(?=\s|$)/g);
  if (matches === null) {
    return text.trim().length > 0 ? 1 : 0;
  }
  const rest = text.replace(/[.!?…]+(?=\s|$)/g, '').trim();
  return matches.length + (rest.length > 0 ? 1 : 0);
}
