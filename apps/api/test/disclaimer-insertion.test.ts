import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runChecks } from '../src/checks/check-engine';
import type { CheckFact, CheckInput } from '../src/checks/check-context';
import { applyDisclaimer, requiredDisclaimer } from '../src/checks/disclaimer';
import type { StyleConfig } from '@dzenwriter/shared';
import { loadAppConfig, resolveConfigDir } from '../src/config/app-config';

const config = loadAppConfig(resolveConfigDir(path.resolve(process.cwd(), '../../config')));

function style(id: string): StyleConfig {
  const found = config.styles.get(id);
  if (!found) {
    throw new Error(`Нет стиля ${id}`);
  }
  return found;
}

const INDUSTRY = style('industry-news');
const EXPERIENCE = style('personal-experience');
const NEWS_DISCLAIMER = INDUSTRY.disclaimer.text;
const EXPERIENCE_DISCLAIMER = EXPERIENCE.disclaimer.text;

const FACT: CheckFact = {
  label: 'F1',
  id: '11111111-1111-4111-8111-111111111111',
  type: 'news_source',
  status: 'approved',
  text: 'Клиники внедрили помощника для пациентов.',
  sourceName: 'Reuters',
  sourceUrl: 'https://example.com/clinics-ai',
  sourcePublishedAt: '2026-10-20',
  mentionsClient: false,
  clientPermission: false,
};

function checksInput(articleMarkdown: string): CheckInput {
  return {
    style: INDUSTRY,
    format: config.formats.formats.news,
    topic: 'Как лечить боль в спине при помощи ИИ',
    keywords: ['здоровье'],
    productName: null,
    facts: [FACT],
    title: 'Помощник в клиниках',
    seoTitle: 'Как ИИ помогает пациентам',
    tags: ['ии', 'медицина', 'клиники', 'практика', 'опыт'],
    articleMarkdown,
    advertisingLabel: false,
    disclaimerText: null,
    claims: [],
    factLabels: ['F1'],
    config: config.checks,
  };
}

describe('правило оговорки', () => {
  it('стиль с always: true требует оговорку на любую тему', () => {
    expect(
      requiredDisclaimer({
        style: EXPERIENCE,
        topic: 'Как я собирал макет дома',
        keywords: ['поделка'],
        config: config.checks,
      }),
    ).toBe(EXPERIENCE_DISCLAIMER);
  });

  it('чувствительная тема требует оговорку по триггеру из checks.yaml', () => {
    expect(
      requiredDisclaimer({
        style: INDUSTRY,
        topic: 'Как ИИ помогает лечить пациентов',
        keywords: ['здоровье'],
        config: config.checks,
      }),
    ).toBe(NEWS_DISCLAIMER);
  });

  it('нейтральная тема — оговорка не нужна', () => {
    expect(
      requiredDisclaimer({
        style: INDUSTRY,
        topic: 'Регулирование ИИ в ЕС',
        keywords: ['ИИ'],
        config: config.checks,
      }),
    ).toBeNull();
  });
});

describe('детерминированная вставка оговорки', () => {
  it('оговорка дописывается отдельным абзацем в конец', () => {
    const applied = applyDisclaimer({
      markdown: '## Заголовок\n\nМодель помогает врачу ставить диагноз быстрее.\n\n',
      style: INDUSTRY,
      topic: 'Как ИИ помогает в лечении пациентов',
      keywords: [],
      config: config.checks,
    });

    expect(applied.markdown).toBe(
      `## Заголовок\n\nМодель помогает врачу ставить диагноз быстрее.\n\n${NEWS_DISCLAIMER}`,
    );
    expect(applied.disclaimerText).toBe(NEWS_DISCLAIMER);
  });

  it('оговорка, уже есть в тексте, не задваивается', () => {
    const markdown = `Текст про терапию в клиниках.\n\n${NEWS_DISCLAIMER}`;
    const applied = applyDisclaimer({
      markdown,
      style: INDUSTRY,
      topic: 'Как ИИ помогает в лечении пациентов',
      keywords: [],
      config: config.checks,
    });

    expect(applied.markdown).toBe(markdown);
    expect(applied.disclaimerText).toBe(NEWS_DISCLAIMER);
  });

  it('нейтральная тема — текст не меняется', () => {
    const applied = applyDisclaimer({
      markdown: 'Текст про регулирование ИИ.',
      style: INDUSTRY,
      topic: 'Регулирование ИИ в ЕС',
      keywords: ['ИИ'],
      config: config.checks,
    });

    expect(applied.markdown).toBe('Текст про регулирование ИИ.');
    expect(applied.disclaimerText).toBeNull();
  });

  it('после вставки чек disclaimer_required не срабатывает', () => {
    const applied = applyDisclaimer({
      markdown: 'Модель помогает врачу ставить диагноз быстрее и точнее.',
      style: INDUSTRY,
      topic: 'Как лечить боль в спине при помощи ИИ',
      keywords: ['здоровье'],
      config: config.checks,
    });

    const result = runChecks(checksInput(applied.markdown));
    expect(result.checks.filter((item) => item.id === 'disclaimer_required')).toEqual([]);
  });

  it('стиль личного опыта получает свою оговорку на любой теме', () => {
    const applied = applyDisclaimer({
      markdown: 'Я пробовал вызвать лифт у тестируемого ассистента.',
      style: EXPERIENCE,
      topic: 'Как я проверял ассистента',
      keywords: ['лифт'],
      config: config.checks,
    });

    expect(applied.markdown.endsWith(EXPERIENCE_DISCLAIMER)).toBe(true);
    expect(applied.disclaimerText).toBe(EXPERIENCE_DISCLAIMER);
  });
});
