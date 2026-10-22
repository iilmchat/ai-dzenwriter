import { describe, expect, it } from 'vitest';
import {
  createFactInputSchema,
  createProductInputSchema,
  factConsentInputSchema,
  FACT_TYPES_BY_POLICY,
  policyAllowsFactType,
  updateFactInputSchema,
  updateProductInputSchema,
} from '../src';

const PRODUCT_ID = '00000000-0000-4000-8000-0000000000aa';

describe('createFactInputSchema', () => {
  it('источник новости без ссылки и даты не принимается, с ними принимается', () => {
    const bare = createFactInputSchema.safeParse({ type: 'news_source', text: 'Цитата' });
    expect(bare.success).toBe(false);
    expect(bare.error?.issues.map((issue) => issue.message)).toEqual([
      'Для источника новости укажите ссылку на материал',
      'Для источника новости укажите дату публикации',
    ]);

    const complete = createFactInputSchema.safeParse({
      type: 'news_source',
      text: 'Цитата из статьи',
      sourceUrl: 'https://example.com/news/1',
      sourcePublishedAt: '2026-10-20',
    });
    expect(complete.success).toBe(true);
  });

  it('ссылка на источник должна быть http или https', () => {
    const result = createFactInputSchema.safeParse({
      type: 'news_source',
      text: 'Цитата',
      sourceUrl: 'ftp://example.com/file',
      sourcePublishedAt: '2026-10-20',
    });
    expect(result.success).toBe(false);
  });

  it('дата публикации не может быть в будущем', () => {
    const result = createFactInputSchema.safeParse({
      type: 'news_source',
      text: 'Цитата',
      sourceUrl: 'https://example.com/news/1',
      sourcePublishedAt: '2999-01-01',
    });
    expect(result.error?.issues[0]?.message).toBe('Дата публикации не может быть в будущем');
  });

  it('факт о продукте требует продукт, заметка опыта создаётся без согласия', () => {
    expect(
      createFactInputSchema.safeParse({ type: 'product_fact', text: 'Факт о продукте' }).success,
    ).toBe(false);
    expect(
      createFactInputSchema.safeParse({
        type: 'product_fact',
        text: 'Факт о продукте',
        productId: PRODUCT_ID,
      }).success,
    ).toBe(true);
    expect(
      createFactInputSchema.safeParse({ type: 'experience_note', text: 'Заметка' }).success,
    ).toBe(true);
  });

  it('пустой текст и неизвестный тип отклоняются', () => {
    expect(createFactInputSchema.safeParse({ type: 'company_fact', text: '   ' }).success).toBe(
      false,
    );
    expect(createFactInputSchema.safeParse({ type: 'rumor', text: 'Слух' }).success).toBe(false);
  });
});

describe('правка и подтверждения', () => {
  it('правка требует версию, null очищает необязательное поле', () => {
    expect(updateFactInputSchema.safeParse({ text: 'Новый текст' }).success).toBe(false);
    const cleared = updateFactInputSchema.safeParse({ expectedVersion: 1, sourceName: null });
    expect(cleared.success).toBe(true);
    expect(cleared.data?.sourceName).toBeNull();
  });

  it('подтверждение согласия требует явного признака обезличивания', () => {
    expect(factConsentInputSchema.safeParse({ expectedVersion: 1 }).success).toBe(false);
    expect(factConsentInputSchema.safeParse({ expectedVersion: 1, anonymized: true }).success).toBe(
      true,
    );
  });
});

describe('политика стиля и типы фактов', () => {
  it('личный опыт принимает только заметки, а статья с источниками — только новости', () => {
    expect(policyAllowsFactType('experience_only', 'experience_note')).toBe(true);
    expect(policyAllowsFactType('experience_only', 'company_fact')).toBe(false);
    expect(policyAllowsFactType('sourced', 'news_source')).toBe(true);
    expect(policyAllowsFactType('approved_only', 'news_source')).toBe(false);
    expect(FACT_TYPES_BY_POLICY.approved_only).toEqual(['company_fact', 'product_fact']);
  });
});

describe('справочник продуктов', () => {
  it('идентификатор продукта — латиница, цифры и дефисы', () => {
    const base = { name: 'Продукт', oneLiner: 'Описание' };
    expect(createProductInputSchema.safeParse({ ...base, slug: 'Demo Product' }).success).toBe(
      false,
    );
    expect(createProductInputSchema.safeParse({ ...base, slug: 'demo-product-2' }).success).toBe(
      true,
    );
  });

  it('пустая правка продукта отклоняется, архивный признак принимается', () => {
    expect(updateProductInputSchema.safeParse({}).success).toBe(false);
    expect(updateProductInputSchema.safeParse({ archived: true }).success).toBe(true);
  });
});
