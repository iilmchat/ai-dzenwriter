import { describe, expect, it } from 'vitest';
import { SearchService } from '../src/search/search.service';
import { InMemorySearchRepository } from './support/in-memory-search.repository';

const SEED = {
  articles: [
    {
      id: '00000000-0000-4000-8000-0000000000a1',
      title: 'Агенты на длинных задачах',
    },
  ],
  facts: [
    {
      id: '00000000-0000-4000-8000-0000000000f1',
      title: 'Команда использует агентов для длинных задач',
    },
  ],
  products: [
    {
      id: '00000000-0000-4000-8000-0000000000e1',
      title: 'Агентная платформа',
      oneLiner: 'Инструмент для длинных задач',
    },
  ],
};

function setup() {
  const repository = new InMemorySearchRepository(SEED);
  return { repository, service: new SearchService(repository) };
}

describe('глобальный поиск', () => {
  it('находит статью, факт и продукт', async () => {
    const { service } = setup();

    const response = await service.search('длинных');

    expect(response.items).toEqual([
      expect.objectContaining({
        type: 'article',
        title: 'Агенты на длинных задачах',
        subtitle: 'Статья',
        url: `/articles/${SEED.articles[0]?.id}`,
      }),
      expect.objectContaining({
        type: 'fact',
        title: 'Команда использует агентов для длинных задач',
        subtitle: 'Факт',
        url: '/facts',
      }),
      expect.objectContaining({
        type: 'product',
        title: 'Агентная платформа',
        subtitle: 'Инструмент для длинных задач',
        url: '/products',
      }),
    ]);
  });

  it('ищет без учёта регистра и обрезает пробелы', async () => {
    const { repository, service } = setup();

    const response = await service.search('  АГЕНТ  ');

    expect(response.items).toHaveLength(3);
    expect(repository.queries).toEqual(['АГЕНТ']);
  });

  it('короткий запрос возвращает пустой список без обращения к базе', async () => {
    const { repository, service } = setup();

    expect(await service.search(' ')).toEqual({ items: [] });
    expect(await service.search('а')).toEqual({ items: [] });
    expect(repository.queries).toEqual([]);
  });

  it('не находит ничего по неизвестному запросу', async () => {
    const { service } = setup();

    expect(await service.search('борщ')).toEqual({ items: [] });
  });
});
