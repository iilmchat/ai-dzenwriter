import { describe, expect, it } from 'vitest';
import { loadAppConfig, resolveConfigDir } from '../src/config/app-config';
import {
  loadBasePrompt,
  loadExpandPrompt,
  loadFragmentPrompt,
  loadTitlesPrompt,
  resolvePromptsDir,
} from '../src/config/prompt-config';
import {
  BRIEF_NOT_SET,
  buildExpandPrompt,
  buildPrompt,
  renderBrief,
  renderFacts,
  renderTemplate,
} from '../src/generation/prompt-builder';

const config = loadAppConfig(resolveConfigDir());
const basePrompt = loadBasePrompt(resolvePromptsDir());
const expandPrompt = loadExpandPrompt(resolvePromptsDir());
const fragmentPrompt = loadFragmentPrompt(resolvePromptsDir());
const titlesPrompt = loadTitlesPrompt(resolvePromptsDir());

describe('сборка промпта', () => {
  it('подставляет все поля шаблона', () => {
    const style = config.styles.get('industry-news');
    const format = config.formats.formats.news;
    if (!style) {
      throw new Error('Нет стиля industry-news');
    }

    const built = buildPrompt({
      basePrompt,
      style,
      format,
      formatId: 'news',
      topic: 'Регулирование ИИ в ЕС',
      keywords: ['ИИ', 'регулирование'],
      tone: 'neutral',
      lengthMin: 4000,
      lengthMax: 6000,
      productName: null,
      facts: [],
      brief: null,
      today: '2026-10-22',
    });

    expect(built.text).not.toMatch(/\{\{\w+\}\}/);
    expect(built.text).toContain('Регулирование ИИ в ЕС');
    expect(built.text).toContain('ИИ, регулирование');
    expect(built.text).toContain('Новости индустрии');
    expect(built.text).toContain('от 4000 до 6000 знаков');
    expect(built.text).toContain('2026-10-22');
  });

  it('передаёт факты как данные с метками F1…Fn', () => {
    const facts = [
      {
        factId: '11111111-1111-4111-8111-111111111111',
        label: 'F1',
        type: 'news_source' as const,
        text: 'Регулирование ИИ в ЕС принято в октябре 2026 года.',
        sourceName: 'Reuters',
        sourceUrl: 'https://example.com/eu-ai-act',
        sourcePublishedAt: '2026-10-20',
      },
      {
        factId: '22222222-2222-4222-8222-222222222222',
        label: 'F2',
        type: 'company_fact' as const,
        text: 'Мы внедрили проверку фактов в конвейер материалов.',
        sourceName: null,
        sourceUrl: null,
        sourcePublishedAt: null,
      },
    ];

    const rendered = renderFacts(facts);

    expect(rendered).toContain('F1 [источник новости]');
    expect(rendered).toContain('Регулирование ИИ в ЕС принято в октябре 2026 года.');
    expect(rendered).toContain('Reuters, 2026-10-20, https://example.com/eu-ai-act');
    expect(rendered).toContain('F2 [факт о компании]');
  });

  it('без одобренных фактов пишет об этом прямо', () => {
    expect(renderFacts([])).toBe('(одобренных фактов нет)');
  });

  // Snapshot-тесты: любое изменение промпта, стиля или сборки видно в PR целиком.
  describe('snapshot собранного промпта', () => {
    const factForSnapshot = [
      {
        factId: '11111111-1111-4111-8111-111111111111',
        label: 'F1',
        type: 'news_source' as const,
        text: 'Регулирование ИИ в ЕС принято в октябре 2026 года.',
        sourceName: 'Reuters',
        sourceUrl: 'https://example.com/eu-ai-act',
        sourcePublishedAt: '2026-10-20',
      },
      {
        factId: '22222222-2222-4222-8222-222222222222',
        label: 'F2',
        type: 'company_fact' as const,
        text: 'Мы внедрили проверку фактов в конвейер материалов.',
        sourceName: null,
        sourceUrl: null,
        sourcePublishedAt: null,
      },
    ];

    it('renderFacts стабилен', () => {
      expect(renderFacts(factForSnapshot)).toMatchSnapshot();
    });

    it.each([
      ['industry-news', 'news'],
      ['company-achievements', 'article'],
      ['personal-experience', 'article'],
      ['product-description', 'article'],
    ] as const)('%s — полный текст промпта стабилен', (styleId, formatId) => {
      const style = config.styles.get(styleId);
      const format = config.formats.formats[formatId];
      if (!style || !format) {
        throw new Error(`Нет стиля ${styleId} или формата ${formatId}`);
      }
      const built = buildPrompt({
        basePrompt,
        style,
        format,
        formatId,
        topic: 'Регулирование ИИ в ЕС',
        keywords: ['ИИ', 'регулирование'],
        tone: 'neutral',
        lengthMin: 4000,
        lengthMax: 6000,
        productName: styleId === 'product-description' ? 'Демо-продукт' : null,
        facts: styleId === 'product-description' ? [] : factForSnapshot,
        brief: styleId === 'industry-news' ? null : '## План\n\n1. Боль читателя.\n2. Тезисы.',
        today: '2026-10-22',
      });
      expect(built.text).not.toMatch(/\{\{\w+\}\}/);
      expect(built.text).toMatchSnapshot();
    });
  });

  it('версия промпта меняется вместе со стилем и стабильна иначе', () => {
    const style = config.styles.get('industry-news');
    if (!style) {
      throw new Error('Нет стиля industry-news');
    }
    const base = {
      basePrompt,
      style,
      format: config.formats.formats.news,
      formatId: 'news' as const,
      topic: 'Тема',
      keywords: [],
      tone: 'neutral' as const,
      lengthMin: 4000,
      lengthMax: 6000,
      productName: null,
      facts: [],
      brief: null,
      today: '2026-10-22',
    };

    const first = buildPrompt(base);
    const second = buildPrompt(base);
    const otherStyle = buildPrompt({ ...base, style: { ...style, version: style.version + 1 } });

    expect(first.promptVersion).toBe(second.promptVersion);
    expect(first.sha256).toBe(second.sha256);
    expect(first.promptVersion).not.toBe(otherStyle.promptVersion);
    expect(first.promptVersion).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(first.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('неизвестная подстановка остаётся в тексте', () => {
    const style = config.styles.get('industry-news');
    if (!style) {
      throw new Error('Нет стиля industry-news');
    }

    const built = buildPrompt({
      basePrompt: 'Значение: {{unknown_value}}',
      style,
      format: config.formats.formats.news,
      formatId: 'news',
      topic: 'Тема',
      keywords: [],
      tone: 'neutral',
      lengthMin: 4000,
      lengthMax: 6000,
      productName: null,
      facts: [],
      brief: null,
      today: '2026-10-22',
    });

    expect(built.text).toBe('Значение: {{unknown_value}}');
  });

  it('подставляет бриф редактора в основной промпт', () => {
    const style = config.styles.get('industry-news');
    if (!style) {
      throw new Error('Нет стиля industry-news');
    }

    const built = buildPrompt({
      basePrompt,
      style,
      format: config.formats.formats.news,
      formatId: 'news',
      topic: 'Тема',
      keywords: [],
      tone: 'neutral',
      lengthMin: 4000,
      lengthMax: 6000,
      productName: null,
      facts: [],
      brief: '## План\n\n1. Боль читателя.\n2. Тезис.',
      today: '2026-10-22',
    });

    expect(built.text).toContain('## План');
    expect(built.text).toContain('1. Боль читателя.');
    expect(built.text).not.toContain(BRIEF_NOT_SET);
  });

  it('без брифа подставляет общее правило', () => {
    const style = config.styles.get('industry-news');
    if (!style) {
      throw new Error('Нет стиля industry-news');
    }

    const built = buildPrompt({
      basePrompt,
      style,
      format: config.formats.formats.news,
      formatId: 'news',
      topic: 'Тема',
      keywords: [],
      tone: 'neutral',
      lengthMin: 4000,
      lengthMax: 6000,
      productName: null,
      facts: [],
      brief: null,
      today: '2026-10-22',
    });

    expect(renderBrief(null)).toBe(BRIEF_NOT_SET);
    expect(renderBrief('   ')).toBe(BRIEF_NOT_SET);
    expect(built.text).toContain(BRIEF_NOT_SET);
  });

  it('renderTemplate набивает шаблон значениями одним проходом', () => {
    expect(renderTemplate('A {{x}} B {{x}} C {{y}}', { x: '1', y: '2' })).toBe('A 1 B 1 C 2');
    expect(renderTemplate('Значение {{x}} {{y}}', { x: '{{y}}' })).toBe('Значение {{y}} {{y}}');
  });
});

describe('промпт доведения объёма', () => {
  it('подставляет текущую версию, каркас формата и целевой объём', () => {
    const format = config.formats.formats.news;

    const built = buildExpandPrompt({
      expandPrompt,
      format,
      topic: 'Регулирование ИИ в ЕС',
      title: 'Тема про ИИ',
      markdown: 'Короткая версия без объёма.',
      facts: [
        {
          factId: '11111111-1111-4111-8111-111111111111',
          label: 'F1',
          type: 'news_source',
          text: 'Регулирование ИИ в ЕС принято в октябре 2026 года.',
          sourceName: 'Reuters',
          sourceUrl: 'https://example.com/eu-ai-act',
          sourcePublishedAt: '2026-10-20',
        },
      ],
    });

    expect(built).not.toMatch(/\{\{\w+\}\}/);
    expect(built).toContain('Короткая версия без объёма.');
    expect(built).toContain('Целевой объём: от 4800');
    expect(built).toContain('F1 [источник новости]');
  });

  it('полный текст промпта доведения стабилен', () => {
    expect(expandPrompt.trim()).toMatchSnapshot();
  });
});

describe('промпт локальной правки фрагмента', () => {
  it('подставляет инструкцию, контекст и только переданные факты', () => {
    const prompt = renderTemplate(fragmentPrompt, {
      instruction: 'Сократить без потери смысла',
      contextBefore: 'Начало абзаца.',
      contextAfter: 'Конец абзаца.',
      selectedText: 'Выделенный текст для правки.',
      facts: renderFacts([
        {
          factId: '11111111-1111-4111-8111-111111111111',
          label: 'F1',
          type: 'news_source',
          text: 'Одобренный факт.',
          sourceName: 'Reuters',
          sourceUrl: null,
          sourcePublishedAt: null,
        },
      ]),
    });

    expect(prompt).not.toMatch(/\{\{\w+\}\}/);
    expect(prompt).toContain('Сократить без потери смысла');
    expect(prompt).toContain('Начало абзаца.');
    expect(prompt).toContain('Конец абзаца.');
    expect(prompt).toContain('Выделенный текст для правки.');
    expect(prompt).toContain('F1 [источник новости]');
    expect(prompt).toContain('Одобренный факт.');
  });

  it('без фактов прямо пишет об их отсутствии', () => {
    const prompt = renderTemplate(fragmentPrompt, {
      instruction: 'Улучшить',
      contextBefore: '(нет)',
      contextAfter: '(нет)',
      selectedText: 'Текст.',
      facts: renderFacts([]),
    });

    expect(prompt).toContain('(одобренных фактов нет)');
  });
});

describe('промпт вариантов заголовка', () => {
  it('подставляет тему, текущий заголовок и бриф', () => {
    const prompt = renderTemplate(titlesPrompt, {
      topic: 'Регулирование ИИ в ЕС',
      currentTitle: 'Старый заголовок',
      brief: '## План\n\n1. Боль читателя.',
    });

    expect(prompt).not.toMatch(/\{\{\w+\}\}/);
    expect(prompt).toContain('Регулирование ИИ в ЕС');
    expect(prompt).toContain('Старый заголовок');
    expect(prompt).toContain('## План');
    expect(prompt).toContain('"titles"');
  });

  it('без брифа подставляет общее правило', () => {
    const prompt = renderTemplate(titlesPrompt, {
      topic: 'Тема',
      currentTitle: 'не задан',
      brief: renderBrief(null),
    });

    expect(prompt).toContain(BRIEF_NOT_SET);
  });
});
