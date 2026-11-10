import type { SearchResultItem } from '@dzenwriter/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchSearch } from '../../api/search';
import { GlobalSearch } from './GlobalSearch';

vi.mock('../../api/search', () => ({
  fetchSearch: vi.fn(),
}));

const mockedFetch = vi.mocked(fetchSearch);

const ARTICLE: SearchResultItem = {
  type: 'article',
  id: '00000000-0000-4000-8000-0000000000a1',
  title: 'Агенты на длинных задачах',
  subtitle: 'Статья',
  url: '/articles/00000000-0000-4000-8000-0000000000a1',
};
const FACT: SearchResultItem = {
  type: 'fact',
  id: '00000000-0000-4000-8000-0000000000f1',
  title: 'Агенты помогают в длинных задачах',
  subtitle: 'Факт',
  url: '/facts',
};
const PRODUCT: SearchResultItem = {
  type: 'product',
  id: '00000000-0000-4000-8000-0000000000e1',
  title: 'Агентная платформа',
  subtitle: 'Инструмент для длинных задач',
  url: '/products',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderSearch() {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<GlobalSearch />} />
        <Route path="/articles/:id" element={<p>Открыта статья</p>} />
        <Route path="/facts" element={<p>Открыта факт-база</p>} />
        <Route path="/products" element={<p>Открыты продукты</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('глобальный поиск', () => {
  it('после ввода показывает сгруппированные результаты', async () => {
    mockedFetch.mockResolvedValue({ items: [ARTICLE, FACT, PRODUCT] });
    renderSearch();

    fireEvent.change(screen.getByLabelText('Глобальный поиск'), {
      target: { value: 'агент' },
    });

    expect(await screen.findByText(ARTICLE.title)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Статьи' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Факты' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Продукты' })).toBeTruthy();
    expect(screen.getByText(PRODUCT.subtitle)).toBeTruthy();
    expect(mockedFetch).toHaveBeenCalledWith('агент');
  });

  it('по клику переходит на страницу результата и очищает поле', async () => {
    mockedFetch.mockResolvedValue({ items: [ARTICLE, FACT, PRODUCT] });
    renderSearch();

    const input = screen.getByLabelText('Глобальный поиск') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'агент' } });
    fireEvent.click(await screen.findByText(ARTICLE.title));

    expect(await screen.findByText('Открыта статья')).toBeTruthy();
    expect(input.value).toBe('');
  });

  it('поддерживает навигацию стрелками и Enter', async () => {
    mockedFetch.mockResolvedValue({ items: [ARTICLE, FACT, PRODUCT] });
    renderSearch();

    const input = screen.getByLabelText('Глобальный поиск');
    fireEvent.change(input, { target: { value: 'агент' } });
    await screen.findByText(ARTICLE.title);

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByText('Открыта факт-база')).toBeTruthy();
  });

  it('показывает «Ничего не найдено» и закрывается по Escape', async () => {
    mockedFetch.mockResolvedValue({ items: [] });
    renderSearch();

    const input = screen.getByLabelText('Глобальный поиск');
    fireEvent.change(input, { target: { value: 'борщ' } });

    expect(await screen.findByText('Ничего не найдено')).toBeTruthy();

    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() =>
      expect(screen.queryByRole('listbox', { name: 'Результаты поиска' })).toBeNull(),
    );
  });
});
