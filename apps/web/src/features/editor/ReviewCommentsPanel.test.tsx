import type { ReviewComment } from '@dzenwriter/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchReviewComments, resolveReviewComment } from '../../api/reviews';
import { ReviewCommentsPanel } from './ReviewCommentsPanel';

vi.mock('../../api/reviews', () => ({
  fetchReviewComments: vi.fn(),
  resolveReviewComment: vi.fn(),
}));

const mockedFetch = vi.mocked(fetchReviewComments);
const mockedResolve = vi.mocked(resolveReviewComment);

const ARTICLE_ID = '00000000-0000-4000-8000-0000000000a1';
const COMMENT: ReviewComment = {
  id: '00000000-0000-4000-8000-000000000001',
  reviewerName: 'Борис',
  comment: 'Уточните источник цифры',
  selectedText: 'Европейский союз принял пакет правил по ИИ.',
  startOffset: 10,
  endOffset: 53,
  isResolved: false,
  createdAt: '2026-10-22T10:00:00.000Z',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('панель комментариев ревьюера', () => {
  it('показывает список комментариев к версии', async () => {
    mockedFetch.mockResolvedValue({ items: [COMMENT] });
    render(<ReviewCommentsPanel articleId={ARTICLE_ID} versionNumber={2} canResolve />);

    expect(await screen.findByText('Уточните источник цифры')).toBeTruthy();
    expect(screen.getByText(COMMENT.selectedText)).toBeTruthy();
    expect(screen.getByText(/Борис/)).toBeTruthy();
    expect(screen.getByText('версия 2')).toBeTruthy();
    expect(mockedFetch).toHaveBeenCalledWith(ARTICLE_ID, 2);
  });

  it('отмечает комментарий решённым и обновляет список', async () => {
    mockedFetch.mockResolvedValue({ items: [COMMENT] });
    mockedResolve.mockResolvedValue({
      items: [{ ...COMMENT, isResolved: true }],
    });
    render(<ReviewCommentsPanel articleId={ARTICLE_ID} versionNumber={2} canResolve />);

    fireEvent.click(await screen.findByRole('button', { name: 'Решено' }));

    await waitFor(() => expect(mockedResolve).toHaveBeenCalledWith(ARTICLE_ID, 2, COMMENT.id));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Решено' })).toBeNull());
    expect(screen.getByText('Решено')).toBeTruthy();
  });

  it('по клику на комментарий передаёт фрагмент для перехода', async () => {
    mockedFetch.mockResolvedValue({ items: [COMMENT] });
    const onFocus = vi.fn();
    render(
      <ReviewCommentsPanel
        articleId={ARTICLE_ID}
        versionNumber={2}
        canResolve={false}
        onFocus={onFocus}
      />,
    );

    fireEvent.click(await screen.findByText('Уточните источник цифры'));

    expect(onFocus).toHaveBeenCalledWith(COMMENT);
  });
});
