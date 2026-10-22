import { describe, expect, it } from 'vitest';
import {
  buildChecklist,
  buildExportFiles,
  buildMetadata,
  buildPublicText,
  exportFileName,
  type ExportArticle,
} from '../src/publications/export-package';

const VERSION = {
  number: 3,
  title: 'Как мы перенесли проверку фактов',
  articleMarkdown: 'Вступление.\n\nОсновная часть.',
  seoTitle: 'Проверка фактов в конвейере',
  tags: ['ии', 'практика', 'факты'],
  description: 'Как мы перенесли проверку фактов в конвейер.',
  imagePrompt: 'Спокойная иллюстрация: экран с кодом.',
  advertisingLabel: false,
  disclaimerText: null,
  styleVersion: 1,
  promptVersion: 'sha256:abc',
  checks: [],
  claims: [{ text: 'Основная часть.', type: 'fact' as const, factIds: ['F1'], start: 13, end: 29 }],
};

const ARTICLE: ExportArticle = {
  id: '11111111-1111-4111-8111-111111111111',
  topic: 'Как мы перенесли проверку фактов',
  keywords: ['ии', 'факты'],
  styleId: 'company-achievements',
  styleName: 'Наш опыт и достижения',
  format: 'article',
  tone: 'neutral',
  productName: null,
  author: 'anna',
  version: VERSION,
  facts: [
    {
      label: 'F1',
      type: 'company_fact',
      sourceName: 'Внутренние данные',
      sourceUrl: null,
      sourcePublishedAt: null,
    },
  ],
};

describe('публичный текст для Дзена', () => {
  it('собирается кодом в формате спецификации Dzen Writer', () => {
    const text = buildPublicText(ARTICLE);

    expect(text).toBe(
      [
        '# Как мы перенесли проверку фактов',
        '',
        'Вступление.',
        '',
        'Основная часть.',
        '',
        '---',
        'SEO_TITLE: Проверка фактов в конвейере',
        'TAGS: ии, практика, факты',
        'DESCRIPTION: Как мы перенесли проверку фактов в конвейер.',
        'IMAGE_PROMPT: Спокойная иллюстрация: экран с кодом.',
        '',
      ].join('\n'),
    );
  });
});

describe('метаданные пакета', () => {
  it('содержат всё, что просит редактор Дзена', () => {
    const metadata = buildMetadata(ARTICLE);

    expect(metadata).toMatchObject({
      topic: 'Как мы перенесли проверку фактов',
      title: 'Как мы перенесли проверку фактов',
      seo_title: 'Проверка фактов в конвейере',
      tags: ['ии', 'практика', 'факты'],
      description: 'Как мы перенесли проверку фактов в конвейер.',
      image_prompt: 'Спокойная иллюстрация: экран с кодом.',
      advertising_label: false,
      style: { id: 'company-achievements', name: 'Наш опыт и достижения' },
      format: 'article',
      author: 'anna',
    });
  });

  it('тексты фактов не попадают в пакет: в заметках опыта могут быть персональные данные', () => {
    const metadata = buildMetadata(ARTICLE) as {
      facts: Record<string, unknown>[];
    };

    // В фактах есть только метка, тип и источник: самого текста факта в пакете нет.
    expect(Object.keys(metadata.facts[0] ?? {}).sort()).toEqual([
      'label',
      'source_name',
      'source_published_at',
      'source_url',
      'type',
    ]);
    expect(JSON.stringify(metadata)).not.toContain('текст факта');
  });

  it('факты и утверждения перечислены метками и источниками', () => {
    const metadata = buildMetadata(ARTICLE) as {
      facts: { label: string; source_name: string | null }[];
      claims: { text: string; fact_ids: string[] }[];
    };

    expect(metadata.facts).toEqual([
      {
        label: 'F1',
        type: 'company_fact',
        source_name: 'Внутренние данные',
        source_url: null,
        source_published_at: null,
      },
    ]);
    expect(metadata.claims[0]?.fact_ids).toEqual(['F1']);
  });
});

describe('чек-лист публикации', () => {
  it('часть пунктов проверяет система, остальные остаются на человеке', () => {
    const items = buildChecklist(ARTICLE);

    expect(items.map((item) => item.id)).toEqual([
      'title_matches_content',
      'text_standalone',
      'ad_disclosure',
      'sources_and_dates',
      'disclaimer',
      'cover_rights',
    ]);
    expect(items.find((item) => item.id === 'text_standalone')?.done).toBeNull();
    expect(items.find((item) => item.id === 'cover_rights')?.done).toBeNull();
  });

  it('обещание без факта помечает пункт про заголовок', () => {
    const items = buildChecklist({
      ...ARTICLE,
      version: {
        ...VERSION,
        checks: [
          {
            id: 'guarantees_forbidden',
            severity: 'block',
            message: '«гарантируем» — обещание, которое нельзя делать без факта',
          },
        ],
      },
    });

    const item = items.find((entry) => entry.id === 'title_matches_content');
    expect(item?.done).toBe(false);
    expect(item?.comment).toContain('гарантируем');
  });

  it('материал о продукте без маркировки помечает пункт про рекламу', () => {
    const items = buildChecklist({ ...ARTICLE, productName: 'Демо-продукт' });

    const item = items.find((entry) => entry.id === 'ad_disclosure');
    expect(item?.done).toBe(false);
    expect(item?.comment).toContain('Демо-продукт');
  });

  it('маркировка и источники закрывают свои пункты', () => {
    const items = buildChecklist({
      ...ARTICLE,
      productName: 'Демо-продукт',
      version: { ...VERSION, advertisingLabel: true },
      facts: [
        {
          label: 'F1',
          type: 'news_source',
          sourceName: 'Reuters',
          sourceUrl: 'https://example.com/news',
          sourcePublishedAt: '2026-10-20',
        },
      ],
    });

    expect(items.find((entry) => entry.id === 'ad_disclosure')?.done).toBe(true);
    expect(items.find((entry) => entry.id === 'sources_and_dates')?.done).toBe(true);
  });
});

describe('состав пакета', () => {
  it('содержит четыре файла с фиксированными именами', () => {
    const files = buildExportFiles(ARTICLE);

    expect(files.map((file) => file.name)).toEqual([
      'article.md',
      'metadata.json',
      'image_prompt.txt',
      'checklist.md',
    ]);
  });

  it('чек-лист в файле отмечает выполненные пункты', () => {
    const files = buildExportFiles(ARTICLE);
    const checklist = files.find((file) => file.name === 'checklist.md');

    expect(checklist?.content).toContain('# Чек-лист перед публикацией');
    expect(checklist?.content).toContain('[ ] Текст самодостаточен');
    expect(checklist?.content).toContain('[x] Источники и даты указаны');
  });

  it('имя файла пакета понятное и безопасное', () => {
    expect(exportFileName(ARTICLE)).toBe('как-мы-перенесли-проверку-фактов-v3.zip');
  });
});
