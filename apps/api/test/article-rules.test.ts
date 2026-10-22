import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  describeTransition,
  emptyFactTotals,
  findTransition,
  gateProblems,
  inputRequirements,
  isInAiFocus,
  lengthWarnings,
  permissionProblem,
  transitionsFrom,
  type GateContext,
} from '../src/articles/article-rules';
import { loadAppConfig, resolveConfigDir } from '../src/config/app-config';

const config = loadAppConfig(resolveConfigDir(path.resolve(process.cwd(), '../../config')));
const newsStyle = config.styles.get('industry-news');
const experienceStyle = config.styles.get('personal-experience');
const productStyle = config.styles.get('product-description');
const OWNER = 'owner-id';
const PRODUCT = 'product-id';

function context(overrides: Partial<GateContext> = {}): GateContext {
  return {
    style: newsStyle,
    productId: null,
    plannedAt: null,
    totals: emptyFactTotals(),
    latest: undefined,
    ...overrides,
  };
}

describe('таблица переходов', () => {
  it('разрешает только переходы из раздела 5 дизайна', () => {
    expect(findTransition('idea', 'researching')).toBeDefined();
    expect(findTransition('idea', 'published')).toBeUndefined();
    expect(findTransition('published', 'idea')).toBeUndefined();
    expect(transitionsFrom('in_review').map((rule) => rule.to)).toEqual(['drafting', 'approved']);
  });

  it('автор и администратор переводят материал, чужой автор — нет', () => {
    const rule = findTransition('idea', 'researching');
    expect(rule).toBeDefined();
    if (!rule) {
      return;
    }
    expect(permissionProblem(rule, { id: OWNER, role: 'author' }, OWNER)).toBeNull();
    expect(permissionProblem(rule, { id: 'other', role: 'admin' }, OWNER)).toBeNull();
    expect(permissionProblem(rule, { id: 'other', role: 'author' }, OWNER)).toMatch(/автор/);
  });

  it('ревьюер не утверждает собственный материал, но утверждает чужой', () => {
    const rule = findTransition('in_review', 'approved');
    expect(rule).toBeDefined();
    if (!rule) {
      return;
    }
    expect(permissionProblem(rule, { id: 'reviewer', role: 'reviewer' }, OWNER)).toBeNull();
    expect(permissionProblem(rule, { id: OWNER, role: 'reviewer' }, OWNER)).toMatch(/собственный/);
    expect(permissionProblem(rule, { id: 'author', role: 'author' }, OWNER)).toMatch(/ревьюер/);
  });

  it('публикацию отмечают автор или ревьюер', () => {
    const rule = findTransition('approved', 'published');
    expect(rule).toBeDefined();
    if (!rule) {
      return;
    }
    expect(permissionProblem(rule, { id: 'reviewer', role: 'reviewer' }, OWNER)).toBeNull();
    expect(permissionProblem(rule, { id: 'stranger', role: 'author' }, OWNER)).toMatch(
      /автор или ревьюер/,
    );
  });
});

describe('условия стиля', () => {
  it('новость без одобренного источника не переходит к черновику', () => {
    const requirements = inputRequirements(newsStyle!, emptyFactTotals(), null);
    expect(requirements[0]).toMatchObject({ required: 1, actual: 0, met: false });
  });

  it('одобренный источник новости закрывает требование', () => {
    const totals = { ...emptyFactTotals(), news_source: { count: 1, chars: 40 } };
    expect(inputRequirements(newsStyle!, totals, null)[0]).toMatchObject({ actual: 1, met: true });
  });

  it('описание продукта требует продукт и три одобренных факта', () => {
    const totals = { ...emptyFactTotals(), product_fact: { count: 2, chars: 80 } };
    const requirements = inputRequirements(productStyle!, totals, null);
    expect(requirements.find((item) => item.title === 'Продукт')).toMatchObject({ met: false });
    expect(requirements[0]).toMatchObject({ required: 3, actual: 2, met: false });
  });

  it('личный опыт требует 800 знаков одобренных заметок', () => {
    const short = { ...emptyFactTotals(), experience_note: { count: 1, chars: 500 } };
    const enough = { ...emptyFactTotals(), experience_note: { count: 1, chars: 900 } };
    const pick = (totals: typeof short) =>
      inputRequirements(experienceStyle!, totals, null).find((item) =>
        item.title.startsWith('Заметки'),
      );
    expect(pick(short)).toMatchObject({ required: 800, met: false });
    expect(pick(enough)).toMatchObject({ met: true });
  });

  it('не хватает фактов — переход блокируется с причиной', () => {
    const rule = findTransition('researching', 'drafting');
    expect(rule).toBeDefined();
    if (!rule) {
      return;
    }
    const problems = gateProblems(rule, context());
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Не хватает');
  });
});

describe('проверка перед ревью', () => {
  it('без версии текста ревью невозможно', () => {
    const rule = findTransition('drafting', 'in_review');
    expect(gateProblems(rule!, context())).toEqual([
      'Нет версии текста: её создаёт генерация или ручная правка',
    ]);
  });

  it('блокирующие проверки версии не пускают на ревью', () => {
    const rule = findTransition('drafting', 'in_review');
    const latest = {
      number: 2,
      advertisingLabel: false,
      checks: [
        { id: 'numbers_must_map_to_facts', severity: 'block' as const },
        { id: 'hook_every_3_paragraphs', severity: 'info' as const },
      ],
    };
    expect(gateProblems(rule!, context({ latest }))).toEqual([
      'В версии 2 блокирующих проверок: 1',
    ]);
  });

  it('текст о продукте без маркировки рекламы не проходит ревью', () => {
    const rule = findTransition('drafting', 'in_review');
    const latest = { number: 1, advertisingLabel: false, checks: [] };
    const problems = gateProblems(
      rule!,
      context({ style: productStyle, productId: PRODUCT, latest }),
    );
    expect(problems).toEqual(['В версии 1 нет маркировки рекламы']);
  });

  it('describeTransition объясняет, почему переход недоступен, и отмечает поля формы', () => {
    const rule = findTransition('in_review', 'drafting');
    const option = describeTransition(rule!, { id: OWNER, role: 'reviewer' }, OWNER, context());
    expect(option).toMatchObject({
      to: 'drafting',
      allowed: false,
      needsComment: true,
      needsUrl: false,
    });
    expect(option.reason).toMatch(/собственный/);
  });
});

describe('предупреждения при создании', () => {
  it('тема про ИИ не получает предупреждения о фокусе', () => {
    expect(isInAiFocus('Агенты на длинных задачах', ['LLM'])).toBe(true);
    expect(isInAiFocus('Рецепт борща', ['суп'])).toBe(false);
    expect(isInAiFocus('Тема про рецепты', ['нейросети'])).toBe(true);
  });

  it('объём вне диапазона формата даёт предупреждение', () => {
    const format = config.formats.formats.news;
    expect(lengthWarnings(format, 4000, 6000)).toEqual([]);
    expect(lengthWarnings(format, 1000, 6000)).toHaveLength(1);
  });
});
