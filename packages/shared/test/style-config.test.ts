import { describe, expect, it } from 'vitest';
import { formatsConfigSchema, styleConfigSchema } from '../src';

const validStyle = {
  id: 'industry-news',
  version: 1,
  name: 'Новости индустрии',
  summary: 'Аналитический разбор событий.',
  audience: 'Разработчики.',
  allowed_formats: ['news', 'article'],
  voice: {
    person: 'third',
    register: 'analytical',
    default_tone: 'neutral',
    reader_address: 'none',
  },
  inputs: { required_fact_types: ['news_source'], min_facts: 1 },
  fact_policy: 'sourced',
  checks: { numbers_must_map_to_facts: 'block', superlatives_need_fact: 'warn' },
  disclaimer: { for_topics: ['medical'], always: false, text: 'Не консультация.' },
  instructions: '- Пиши по фактам.',
};

describe('styleConfigSchema', () => {
  it('принимает корректный стиль', () => {
    expect(styleConfigSchema.safeParse(validStyle).success).toBe(true);
  });

  it('отклоняет неизвестную проверку', () => {
    const result = styleConfigSchema.safeParse({
      ...validStyle,
      checks: { made_up_check: 'block' },
    });
    expect(result.success).toBe(false);
  });

  it('отклоняет лишние поля верхнего уровня', () => {
    expect(styleConfigSchema.safeParse({ ...validStyle, extra: true }).success).toBe(false);
  });

  it('отклоняет политику фактов вне списка', () => {
    expect(styleConfigSchema.safeParse({ ...validStyle, fact_policy: 'anything' }).success).toBe(
      false,
    );
  });
});

describe('formatsConfigSchema', () => {
  it('требует описания всех пяти форматов', () => {
    const result = formatsConfigSchema.safeParse({
      unit: 'chars_with_spaces',
      default_length: { min: 6000, max: 8000 },
      formats: {
        news: { name: 'Новость', length: { min: 4000, max: 6000 }, structure: 'лид' },
      },
    });
    expect(result.success).toBe(false);
  });
});
