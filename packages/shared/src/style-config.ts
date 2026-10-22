import { z } from 'zod';
import {
  ARTICLE_FORMATS,
  DISCLAIMER_TOPICS,
  FACT_POLICIES,
  FACT_TYPES,
  STYLE_CHECK_IDS,
  TONES,
  type ArticleFormat,
} from './enums';

const lengthRange = z
  .object({
    min: z.number().int().positive(),
    max: z.number().int().positive(),
  })
  .strict()
  .refine((range) => range.min <= range.max, { message: 'min must not exceed max' });

const knownCheckIds = new Set<string>(STYLE_CHECK_IDS);

const checksSchema = z.record(z.string(), z.enum(['block', 'warn'])).superRefine((checks, ctx) => {
  for (const key of Object.keys(checks)) {
    if (!knownCheckIds.has(key)) {
      ctx.addIssue({ code: 'custom', message: `unknown check "${key}"`, path: [key] });
    }
  }
});

export const styleConfigSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'id must be kebab-case'),
    version: z.number().int().positive(),
    name: z.string().min(1),
    summary: z.string().min(1),
    audience: z.string().min(1),
    allowed_formats: z.array(z.enum(ARTICLE_FORMATS)).min(1),
    voice: z
      .object({
        person: z.enum(['first', 'we', 'third']),
        register: z.string().min(1),
        default_tone: z.enum(TONES),
        reader_address: z.enum(['you', 'none']),
      })
      .strict(),
    inputs: z
      .object({
        required_fact_types: z.array(z.enum(FACT_TYPES)).min(1),
        min_facts: z.number().int().min(0),
        min_note_chars: z.number().int().positive().optional(),
        requires_approval: z.boolean().optional(),
        requires_product: z.boolean().optional(),
        requires_consent: z.boolean().optional(),
        requires_anonymization: z.boolean().optional(),
        illustrative_allowed: z.boolean().optional(),
      })
      .strict(),
    fact_policy: z.enum(FACT_POLICIES),
    checks: checksSchema,
    disclaimer: z
      .object({
        for_topics: z.array(z.enum(DISCLAIMER_TOPICS)),
        always: z.boolean(),
        text: z.string().min(1),
      })
      .strict(),
    instructions: z.string().min(1),
  })
  .strict();

const formatSchema = z
  .object({
    name: z.string().min(1),
    length: lengthRange,
    blocks: lengthRange.optional(),
    items: lengthRange.optional(),
    structure: z.string().min(1),
  })
  .strict();

export const formatsConfigSchema = z
  .object({
    unit: z.literal('chars_with_spaces'),
    default_length: lengthRange,
    formats: z.record(z.enum(ARTICLE_FORMATS), formatSchema),
  })
  .strict();

export type StyleConfig = z.infer<typeof styleConfigSchema>;
export type FormatsConfig = z.infer<typeof formatsConfigSchema>;
export type FormatConfig = FormatsConfig['formats'][ArticleFormat];
