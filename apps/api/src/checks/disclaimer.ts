import type { ChecksConfig, StyleConfig } from '@dzenwriter/shared';

export interface DisclaimerInput {
  readonly style: StyleConfig;
  readonly topic: string;
  readonly keywords: readonly string[];
  readonly config: ChecksConfig;
}

export interface DisclaimerApplied {
  readonly markdown: string;
  // Текст оговорки стиля, который код гарантированно держит в тексте версии.
  readonly disclaimerText: string | null;
}

// Текст оговорки, который нужен материалу: правило стиля или тема с триггером
// из checks.yaml. null — оговорка не нужна. Источник правила один: по нему
// работают и проверка disclaimer_required, и детерминированная вставка.
export function requiredDisclaimer(input: DisclaimerInput): string | null {
  if (input.style.disclaimer.always) {
    return input.style.disclaimer.text;
  }
  const topic = [input.topic, ...input.keywords].join(' ').toLowerCase();
  for (const triggers of Object.values(input.config.disclaimer_triggers)) {
    if (triggers.some((trigger) => topic.includes(trigger.toLowerCase()))) {
      return input.style.disclaimer.text;
    }
  }
  return null;
}

// Оговорку в текст ставит код, а не модель: модель её парафразит, а проверка
// ищет точный текст из стиля. Применяется до проверок, поэтому текст версии,
// поле disclaimerText и проверки всегда согласованы. Оговорка, уже есть
// в тексте, не задваивается: повторная вставка ищет точное вхождение.
export function applyDisclaimer(
  input: DisclaimerInput & { readonly markdown: string },
): DisclaimerApplied {
  const disclaimer = requiredDisclaimer(input);
  const needle = (disclaimer ?? '').trim().toLowerCase();
  if (needle.length === 0) {
    return { markdown: input.markdown, disclaimerText: null };
  }
  if (input.markdown.toLowerCase().includes(needle)) {
    return { markdown: input.markdown, disclaimerText: disclaimer };
  }
  return {
    markdown: `${input.markdown.replace(/\s+$/u, '')}\n\n${disclaimer}`,
    disclaimerText: disclaimer,
  };
}
