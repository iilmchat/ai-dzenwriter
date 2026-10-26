import { describe, expect, it } from 'vitest';
import { loadAppConfig, resolveConfigDir } from '../src/config/app-config';
import { loadBasePrompt, resolvePromptsDir } from '../src/config/prompt-config';
import { buildPrompt, renderFacts } from '../src/generation/prompt-builder';

const config = loadAppConfig(resolveConfigDir());
const basePrompt = loadBasePrompt(resolvePromptsDir());

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
      today: '2026-10-22',
    });

    expect(built.text).toBe('Значение: {{unknown_value}}');
  });
});
