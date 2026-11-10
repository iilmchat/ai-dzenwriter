import type { ArticleDetail, ArticleItem } from '@dzenwriter/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchArticles, transitionArticle } from '../api/articles';
import { BoardPage } from './BoardPage';

const ADMIN = vi.hoisted(() => ({
  id: '00000000-0000-4000-8000-000000000001',
  login: 'anna',
  name: 'Анна Иванова',
  role: 'admin' as const,
}));

vi.mock('../api/articles', () => ({
  fetchArticles: vi.fn(),
  transitionArticle: vi.fn(),
}));

vi.mock('../features/catalog/useCatalog', () => ({
  useCatalog: () => ({ styles: [], formats: [], products: [], loaded: true, failed: false }),
}));

vi.mock('../session/SessionContext', () => ({
  useSession: () => ({
    state: { phase: 'authenticated', user: ADMIN },
    signOut: vi.fn(),
  }),
}));

const mockedFetch = vi.mocked(fetchArticles);
const mockedTransition = vi.mocked(transitionArticle);

const ARTICLE_ID = '00000000-0000-4000-8000-0000000000a1';
const TOPIC = 'Агенты на длинных задачах';

const ITEM: ArticleItem = {
  id: ARTICLE_ID,
  topic: TOPIC,
  keywords: ['LLM'],
  title: null,
  styleId: 'industry-news',
  styleName: 'Новости индустрии',
  format: 'article',
  tone: 'neutral',
  lengthMin: 8000,
  lengthMax: 12000,
  productId: null,
  status: 'idea',
  owner: ADMIN,
  reviewer: null,
  plannedAt: null,
  currentVersionNumber: null,
  blockingChecks: 0,
  version: 1,
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-21T10:00:00.000Z',
};

function setup(item: ArticleItem = ITEM) {
  mockedFetch.mockResolvedValue({ items: [item], truncated: false });
  mockedTransition.mockResolvedValue({
    ...item,
    status: 'researching',
  } as unknown as ArticleDetail);
  render(
    <MemoryRouter>
      <BoardPage />
    </MemoryRouter>,
  );
}

function column(title: string): HTMLElement {
  const section = screen.getByRole('heading', { name: new RegExp(`^${title}`) }).closest('section');
  if (!section) {
    throw new Error(`Нет колонки ${title}`);
  }
  return section;
}

function dragTo(columnTitle: string) {
  const card = screen.getByText(TOPIC).closest('li');
  if (!card) {
    throw new Error('Нет карточки материала');
  }
  const dataTransfer = { effectAllowed: '', setData: vi.fn() };
  fireEvent.dragStart(card, { dataTransfer });
  const target = column(columnTitle);
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('переходы с доски', () => {
  it('перетаскивание в «Опубликовано» открывает диалог ссылки', async () => {
    setup();
    await screen.findByText(TOPIC);

    dragTo('Опубликовано');

    expect(screen.getByRole('dialog', { name: 'Публикация материала' })).toBeTruthy();
    expect(screen.getByLabelText('Ссылка на статью в Дзене')).toBeTruthy();
    expect(mockedTransition).not.toHaveBeenCalled();
  });

  it('после ввода ссылки вызывает API перехода', async () => {
    setup();
    await screen.findByText(TOPIC);
    dragTo('Опубликовано');

    const input = screen.getByLabelText('Ссылка на статью в Дзене');
    fireEvent.change(input, { target: { value: 'https://dzen.ru/a/demo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Переместить' }));

    await waitFor(() =>
      expect(mockedTransition).toHaveBeenCalledWith(ARTICLE_ID, {
        to: 'published',
        expectedVersion: 1,
        externalUrl: 'https://dzen.ru/a/demo',
      }),
    );
    expect(screen.queryByRole('dialog', { name: 'Публикация материала' })).toBeNull();
  });

  it('переход без обязательных данных не открывает диалог', async () => {
    setup();
    await screen.findByText(TOPIC);

    dragTo('Факты');

    await waitFor(() =>
      expect(mockedTransition).toHaveBeenCalledWith(ARTICLE_ID, {
        to: 'researching',
        expectedVersion: 1,
      }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('отмена диалога оставляет карточку на месте', async () => {
    setup();
    await screen.findByText(TOPIC);
    dragTo('Опубликовано');

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockedTransition).not.toHaveBeenCalled();
    expect(screen.getByText(TOPIC).closest('section')?.textContent).toContain('Идея');
  });

  it('возврат из ревью требует комментарий минимум 10 знаков', async () => {
    setup({ ...ITEM, status: 'in_review' });
    await screen.findByText(TOPIC);
    dragTo('Черновик');

    const textarea = screen.getByLabelText('Комментарий к возврату');
    fireEvent.change(textarea, { target: { value: 'Коротко' } });
    fireEvent.click(screen.getByRole('button', { name: 'Переместить' }));
    expect(screen.getByRole('alert').textContent).toContain('короче 10');

    fireEvent.change(textarea, { target: { value: 'Уточните источник цифр' } });
    fireEvent.click(screen.getByRole('button', { name: 'Переместить' }));

    await waitFor(() =>
      expect(mockedTransition).toHaveBeenCalledWith(ARTICLE_ID, {
        to: 'drafting',
        expectedVersion: 1,
        comment: 'Уточните источник цифр',
      }),
    );
  });
});
