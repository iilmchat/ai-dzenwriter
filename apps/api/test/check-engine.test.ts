import path from 'node:path';
import type { StyleConfig } from '@dzenwriter/shared';
import { describe, expect, it } from 'vitest';
import { runChecks } from '../src/checks/check-engine';
import type { CheckFact, CheckInput } from '../src/checks/check-context';
import { loadAppConfig, resolveConfigDir } from '../src/config/app-config';

const config = loadAppConfig(resolveConfigDir(path.resolve(process.cwd(), '../../config')));
const checksConfig = config.checks;

const NEWS_FACT: CheckFact = {
  label: 'F1',
  id: '11111111-1111-4111-8111-111111111111',
  type: 'news_source',
  status: 'approved',
  text: 'Европейский союз принял пакет правил по ИИ 20 октября 2026 года.',
  sourceName: 'Reuters',
  sourceUrl: 'https://example.com/eu-ai-act',
  sourcePublishedAt: '2026-10-20',
  mentionsClient: false,
  clientPermission: false,
};

const ARTICLE = `## Заголовок

Европейский союз принял пакет правил по ИИ. Правила вступают в силу с 1 января 2027 года.

Что это значит для разработчиков? Нужно пересмотреть подход к проверке моделей.

Разбираем по шагам.

## Итог

Следите за обновлениями.`;

function styleWith(overrides: Partial<StyleConfig['checks']>, base = 'industry-news'): StyleConfig {
  const style = config.styles.get(base);
  if (!style) {
    throw new Error(`Нет стиля ${base}`);
  }
  const checks: StyleConfig['checks'] = { ...style.checks };
  for (const [id, severity] of Object.entries(overrides)) {
    if (severity === undefined) {
      delete checks[id];
    } else {
      checks[id] = severity;
    }
  }
  return { ...style, checks };
}

function input(overrides: Partial<CheckInput> = {}): CheckInput {
  const style = overrides.style ?? styleWith({});
  return {
    style,
    format: config.formats.formats.news,
    topic: 'Регулирование ИИ в Европейском союзе',
    keywords: ['ИИ'],
    productName: null,
    facts: [NEWS_FACT],
    title: 'Регулирование ИИ',
    seoTitle: 'Как правила ЕС меняют работу с ИИ',
    tags: ['ии', 'регулирование', 'евросоюз', 'разработка', 'практика'],
    articleMarkdown: ARTICLE,
    advertisingLabel: false,
    disclaimerText: null,
    claims: [],
    factLabels: ['F1'],
    config: checksConfig,
    ...overrides,
  };
}

function ids(checks: readonly { readonly id: string }[]): string[] {
  return checks.map((item) => item.id);
}

describe('проверка чисел', () => {
  it('число, которого нет в фактах, блокирует', () => {
    const result = runChecks(
      input({
        style: styleWith({ numbers_must_map_to_facts: 'block' }),
        articleMarkdown: 'Пакет правил содержит 42 поправки и вступает в силу 1 января 2027 года.',
      }),
    );

    const numbers = result.checks.filter((item) => item.id === 'numbers_must_map_to_facts');
    expect(numbers.length).toBeGreaterThan(0);
    expect(numbers[0]?.message).toContain('42');
  });

  it('число из факта проходит', () => {
    const result = runChecks(
      input({
        style: styleWith({ numbers_must_map_to_facts: 'block' }),
        articleMarkdown: 'Пакет правил принят 20 октября 2026 года и касается 1 января 2027 года.',
      }),
    );

    // Даты из факта не должны считаться чужими числами.
    const numbers = result.checks.filter((item) => item.id === 'numbers_must_map_to_facts');
    expect(numbers).toEqual([]);
  });

  it('тысячи с пробелом и запятая нормализуются', () => {
    const fact: CheckFact = {
      ...NEWS_FACT,
      text: 'Компания сообщила о 1 500 пользователях и росте на 3,5 процента.',
    };
    const result = runChecks(
      input({
        style: styleWith({ numbers_must_map_to_facts: 'block' }),
        facts: [fact],
        articleMarkdown: 'У компании 1 500 пользователей и рост 3,5 процента.',
      }),
    );

    expect(result.checks.filter((item) => item.id === 'numbers_must_map_to_facts')).toEqual([]);
  });
});

describe('проверка имён', () => {
  it('имя, которого нет в фактах, блокирует', () => {
    const result = runChecks(
      input({
        style: styleWith({ names_must_map_to_facts: 'block' }),
        articleMarkdown: 'Мы перенесли базу на PostgreSQL и проверили работу с облаком.',
      }),
    );

    const names = result.checks.filter((item) => item.id === 'names_must_map_to_facts');
    expect(names.length).toBeGreaterThan(0);
    expect(names[0]?.message).toContain('PostgreSQL');
  });

  it('имя из факта проходит', () => {
    const result = runChecks(
      input({
        style: styleWith({ names_must_map_to_facts: 'block' }),
        articleMarkdown: 'Европейский союз принял пакет правил по ИИ.',
      }),
    );

    expect(result.checks.filter((item) => item.id === 'names_must_map_to_facts')).toEqual([]);
  });

  it('обычное слово с большой буквы именем не считается', () => {
    const result = runChecks(
      input({
        style: styleWith({ names_must_map_to_facts: 'block' }),
        articleMarkdown: 'Кроме того, пакет правил касается рынка. Потому проверьте внедрение.',
      }),
    );

    expect(result.checks.filter((item) => item.id === 'names_must_map_to_facts')).toEqual([]);
  });

  it('метка факта в тексте не считается ни именем, ни числом', () => {
    const result = runChecks(
      input({
        style: styleWith({ names_must_map_to_facts: 'block', numbers_must_map_to_facts: 'block' }),
        articleMarkdown: 'Факт F1 раскрыт в тексте материала.',
      }),
    );

    expect(result.checks.filter((item) => item.id === 'names_must_map_to_facts')).toEqual([]);
    expect(result.checks.filter((item) => item.id === 'numbers_must_map_to_facts')).toEqual([]);
  });

  it('первое слово после точки в конце предложения именем не считается', () => {
    // Баг прогона №2: точка обрезалась из слова, «между» перестало видеть её,
    // и обычные слова после точки («Таким», «Основное») ловились как имена.
    const result = runChecks(
      input({
        style: styleWith({ names_must_map_to_facts: 'block' }),
        articleMarkdown: 'Мы утвердили план. Таким образом, работа пошла быстрее.',
      }),
    );

    expect(result.checks.filter((item) => item.id === 'names_must_map_to_facts')).toEqual([]);
  });

  it('соседние слова-кандидаты не сливаются через границу предложения', () => {
    // Баг прогона №2: «ИИ» склеивалось со следующим предложением («ИИ⏎⏎Несмотря»),
    // начало предложения было не границей имени.
    const result = runChecks(
      input({
        style: styleWith({ names_must_map_to_facts: 'block' }),
        articleMarkdown: 'Мы доверяем ИИ.\n\nНесмотря на это, качество текста выросло.',
      }),
    );

    expect(result.checks.filter((item) => item.id === 'names_must_map_to_facts')).toEqual([]);
  });

  it('дефисные продолжения аббревиатуры именем не считаются', () => {
    // «ИИ-ассистентом» раньше матчится целиком: дефис не был границей токена.
    const result = runChecks(
      input({
        style: styleWith({ names_must_map_to_facts: 'block' }),
        articleMarkdown: 'Работа с ИИ-ассистентом стала нормой в редакции.',
      }),
    );

    expect(result.checks.filter((item) => item.id === 'names_must_map_to_facts')).toEqual([]);
  });
});

describe('проверка утверждений', () => {
  it('утверждение о факте без fact_ids блокирует', () => {
    const result = runChecks(
      input({
        style: styleWith({ claims_need_factIds: 'block' }),
        claims: [{ text: 'Пакет приняли в ЕС', type: 'fact', factIds: [] }],
      }),
    );

    expect(ids(result.checks)).toContain('claims_need_fact_ids');
  });

  it('утверждение с неизвестной меткой блокирует', () => {
    const result = runChecks(
      input({
        style: styleWith({ claims_need_factIds: 'block' }),
        claims: [{ text: 'Пакет приняли в ЕС', type: 'fact', factIds: ['F7'] }],
      }),
    );

    const found = result.checks.find((item) => item.id === 'claims_need_fact_ids');
    expect(found?.message).toContain('F7');
  });

  it('гипотеза с fact_ids блокирует', () => {
    const result = runChecks(
      input({
        style: styleWith({ claims_need_factIds: 'block' }),
        claims: [{ text: 'Рынок вырастет', type: 'hypothesis', factIds: ['F1'] }],
      }),
    );

    expect(ids(result.checks)).toContain('claims_need_fact_ids');
  });

  it('корректное утверждение проходит и получает место в тексте', () => {
    const result = runChecks(
      input({
        style: styleWith({ claims_need_factIds: 'block' }),
        claims: [
          { text: 'Европейский союз принял пакет правил по ИИ', type: 'fact', factIds: ['F1'] },
        ],
      }),
    );

    expect(result.checks.filter((item) => item.id === 'claims_need_fact_ids')).toEqual([]);
    expect(result.claims[0]?.start).toBeGreaterThan(0);
    expect(result.claims[0]?.factIds).toEqual(['F1']);
  });
});

describe('стилевые проверки', () => {
  it('превосходная степень без факта срабатывает', () => {
    const result = runChecks(
      input({
        style: styleWith({ superlatives_need_fact: 'warn' }),
        articleMarkdown: 'Это лучшее решение на рынке, и мы доказали это.',
      }),
    );

    expect(ids(result.checks)).toContain('superlatives_need_fact');
  });

  it('превосходная степень, подтверждённая фактом, проходит', () => {
    const fact: CheckFact = { ...NEWS_FACT, text: 'Решение признано лучшим на рынке.' };
    const result = runChecks(
      input({
        style: styleWith({ superlatives_need_fact: 'warn' }),
        facts: [fact],
        articleMarkdown: 'Это лучшее решение на рынке, и мы доказали это.',
      }),
    );

    expect(result.checks.filter((item) => item.id === 'superlatives_need_fact')).toEqual([]);
  });

  it('гарантия запрещена', () => {
    const result = runChecks(
      input({
        style: styleWith({ guarantees_forbidden: 'block' }),
        articleMarkdown: 'Мы гарантируем, что модель ответит точно.',
      }),
    );

    expect(ids(result.checks)).toContain('guarantees_forbidden');
  });

  it('в личном опыте нужно первое лицо', () => {
    const result = runChecks(
      input({
        style: styleWith({ first_person_expected: 'block' }, 'personal-experience'),
        articleMarkdown: 'Настройка заняла неделю, а результат оказался неожиданным.',
      }),
    );

    expect(ids(result.checks)).toContain('first_person_expected');
  });

  it('в личном опыте первое лицо проходит', () => {
    const result = runChecks(
      input({
        style: styleWith({ first_person_expected: 'block' }, 'personal-experience'),
        articleMarkdown: 'Я потратил неделю на настройку, и результат оказался неожиданным.',
      }),
    );

    expect(result.checks.filter((item) => item.id === 'first_person_expected')).toEqual([]);
  });

  it('в личном опыте имя компании блокирует', () => {
    const result = runChecks(
      input({
        style: styleWith({ personal_names_forbidden: 'block' }, 'personal-experience'),
        topic: 'Как я настроил рабочую систему',
        keywords: [],
        articleMarkdown:
          'Я настроил систему, а потом попросил коллегу из Acme проверить результат.',
      }),
    );

    const found = result.checks.find((item) => item.id === 'personal_names_forbidden');
    expect(found?.message).toContain('Acme');
  });

  it('клиент без разрешения блокирует', () => {
    const fact: CheckFact = {
      ...NEWS_FACT,
      type: 'company_fact',
      text: 'Клиент Acme попросил доработать конвейер.',
      mentionsClient: true,
      clientPermission: false,
    };
    const result = runChecks(
      input({
        style: styleWith({ client_names_need_permission: 'block' }, 'company-achievements'),
        facts: [fact],
        articleMarkdown: 'Работали с Acme над конвейером и перенесли проверку фактов.',
      }),
    );

    expect(ids(result.checks)).toContain('client_names_need_permission');
  });

  it('клиент с разрешением проходит', () => {
    const fact: CheckFact = {
      ...NEWS_FACT,
      type: 'company_fact',
      text: 'Клиент Acme попросил доработать конвейер.',
      mentionsClient: true,
      clientPermission: true,
    };
    const result = runChecks(
      input({
        style: styleWith({ client_names_need_permission: 'block' }, 'company-achievements'),
        facts: [fact],
        articleMarkdown: 'Работали с Acme над конвейером и перенесли проверку фактов.',
      }),
    );

    expect(result.checks.filter((item) => item.id === 'client_names_need_permission')).toEqual([]);
  });

  it('текст о продукте без маркировки рекламы срабатывает', () => {
    const result = runChecks(
      input({
        style: styleWith({ ad_disclosure_required: 'block' }, 'product-description'),
        productName: 'Демо-продукт',
        facts: [],
      }),
    );

    expect(ids(result.checks)).toContain('ad_disclosure_required');
  });

  it('маркировка рекламы снимает срабатывание', () => {
    const result = runChecks(
      input({
        style: styleWith({ ad_disclosure_required: 'block' }, 'product-description'),
        productName: 'Демо-продукт',
        advertisingLabel: true,
        facts: [],
      }),
    );

    expect(result.checks.filter((item) => item.id === 'ad_disclosure_required')).toEqual([]);
  });

  it('в тексте о продукте нужен раздел об ограничениях', () => {
    const result = runChecks(
      input({
        style: styleWith({ limitations_section_required: 'warn' }, 'product-description'),
        productName: 'Демо-продукт',
        facts: [],
        articleMarkdown: 'Продукт принимает записи на русском языке и работает без интеграции.',
      }),
    );

    expect(ids(result.checks)).toContain('limitations_section_required');
  });

  it('источник без даты публикации срабатывает', () => {
    const fact: CheckFact = { ...NEWS_FACT, sourcePublishedAt: null };
    const result = runChecks(
      input({
        style: styleWith({ source_date_required: 'block' }),
        facts: [fact],
      }),
    );

    expect(ids(result.checks)).toContain('source_date_required');
  });
});

describe('общие проверки', () => {
  it('длинный заголовок блокирует', () => {
    const result = runChecks(input({ title: 'а'.repeat(81) }));

    expect(ids(result.checks)).toContain('title_length');
  });

  it('длинный SEO-заголовок блокирует', () => {
    const result = runChecks(input({ seoTitle: 'а'.repeat(71) }));

    expect(ids(result.checks)).toContain('seo_title_length');
  });

  it('неверное число тегов блокирует', () => {
    const result = runChecks(input({ tags: ['ии', 'практика'] }));

    expect(ids(result.checks)).toContain('tags_count');
  });

  it('короткий текст даёт предупреждение об объёме', () => {
    const result = runChecks(input({ articleMarkdown: 'Короткий текст.' }));

    expect(ids(result.checks)).toContain('length_in_range');
  });

  it('штамп из промпта даёт предупреждение', () => {
    const result = runChecks(
      input({ articleMarkdown: 'Важно отметить, что правила вступают в силу с нового года.' }),
    );

    expect(ids(result.checks)).toContain('banned_phrases');
  });

  it('кликбейт даёт предупреждение', () => {
    const result = runChecks(input({ articleMarkdown: 'Срочно: правила уже вступили в силу.' }));

    expect(ids(result.checks)).toContain('clickbait_phrases');
  });

  it('три абзаца без крючка дают замечание', () => {
    const result = runChecks(
      input({
        articleMarkdown: [
          'Первый абзац описывает положение дел.',
          'Второй абзац продолжает описание.',
          'Третий абзац закрывает тему.',
        ].join('\n\n'),
      }),
    );

    expect(ids(result.checks)).toContain('hook_every_3_paragraphs');
  });

  it('абзац длиннее четырёх предложений даёт замечание', () => {
    const result = runChecks(
      input({
        articleMarkdown:
          'Первое предложение. Второе предложение. Третье предложение. Четвёртое предложение. Пятое предложение.',
      }),
    );

    expect(ids(result.checks)).toContain('paragraph_length');
  });

  it('медицинская тема требует оговорки', () => {
    const result = runChecks(
      input({
        topic: 'Как лечить боль в спине при помощи ИИ',
        keywords: ['здоровье'],
        articleMarkdown: 'Модель помогает врачу ставить диагноз быстрее и точнее.',
      }),
    );

    expect(ids(result.checks)).toContain('disclaimer_required');
  });

  it('медицинская тема с оговоркой проходит', () => {
    const result = runChecks(
      input({
        topic: 'Как лечить боль в спине при помощи ИИ',
        keywords: ['здоровье'],
        articleMarkdown: `Модель помогает врачу ставить диагноз быстрее. ${config.styles.get('industry-news')?.disclaimer.text ?? ''}`,
      }),
    );

    expect(result.checks.filter((item) => item.id === 'disclaimer_required')).toEqual([]);
  });
});

describe('порядок и полнота результата', () => {
  it('блокирующие проверки идут первыми', () => {
    const result = runChecks(
      input({
        title: 'а'.repeat(81),
        articleMarkdown: 'Короткий текст. Важно отметить, что так нельзя.',
      }),
    );

    const severities = result.checks.map((item) => item.severity);
    expect(severities.indexOf('block')).toBe(0);
    expect(severities.lastIndexOf('block')).toBeLessThan(severities.indexOf('warn'));
  });

  it('у сработавшей проверки есть место в тексте', () => {
    const result = runChecks(
      input({
        style: styleWith({ numbers_must_map_to_facts: 'block' }),
        articleMarkdown: 'Пакет правил содержит 42 поправки.',
      }),
    );

    const found = result.checks.find((item) => item.id === 'numbers_must_map_to_facts');
    expect(found?.start).toBeGreaterThan(0);
    expect(found?.excerpt).toBe('42');
  });
});
