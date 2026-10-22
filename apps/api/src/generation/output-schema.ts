// JSON-схема ответа модели для structured output. Держим в одном месте с Zod-схемой
// generationOutputSchema из packages/shared: провайдер получает эту, сервис проверяет ту.
export const GENERATION_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'status',
    'title',
    'article_markdown',
    'seo_title',
    'tags',
    'description',
    'image_prompt',
    'claims',
    'questions',
    'advertising_label_suggested',
    'disclaimer_needed',
  ],
  properties: {
    status: { type: 'string', enum: ['ok', 'needs_input'] },
    title: { type: 'string', description: 'Заголовок до 80 знаков' },
    article_markdown: { type: 'string', description: 'Тело статьи без H1' },
    seo_title: { type: 'string', description: 'SEO-заголовок до 70 знаков' },
    tags: { type: 'array', items: { type: 'string' }, minItems: 5, maxItems: 7 },
    description: { type: 'string', description: 'Описание для превью, 1–2 предложения' },
    image_prompt: { type: 'string', description: 'Промпт для обложки на русском' },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'type', 'fact_ids'],
        properties: {
          text: { type: 'string' },
          type: { type: 'string', enum: ['fact', 'hypothesis', 'opinion'] },
          fact_ids: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    questions: { type: 'array', items: { type: 'string' } },
    advertising_label_suggested: { type: 'boolean' },
    disclaimer_needed: { type: 'boolean' },
  },
};
