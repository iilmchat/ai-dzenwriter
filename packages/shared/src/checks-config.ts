import { z } from 'zod';

// Правила движка проверок, общие для всех стилей. Лежат в config/checks.yaml:
// меняются через PR вместе с промптом, а не в коде.
const phraseList = z.array(z.string().trim().min(1)).min(1);

// Слова, которые не считаются именем: они с заглавной буквы, но именами не являются.
const nameStopWords = z.array(z.string().trim().min(1)).min(1);

// Слова, по которым абзац считается крючком.
const hookMarkers = z.array(z.string().trim().min(1)).min(1);

// Слова темы, по которым понятно, что нужен дисклеймер.
const disclaimerTriggers = z
  .object({
    medical: phraseList,
    legal: phraseList,
    financial: phraseList,
  })
  .strict();

export const checksConfigSchema = z
  .object({
    banned_phrases: phraseList,
    clickbait_phrases: phraseList,
    forbidden_guarantees: phraseList,
    superlative_words: phraseList,
    name_stop_words: nameStopWords,
    hook_markers: hookMarkers,
    disclaimer_triggers: disclaimerTriggers,
  })
  .strict();

export type ChecksConfig = z.infer<typeof checksConfigSchema>;
