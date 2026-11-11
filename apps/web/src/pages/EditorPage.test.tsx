import type { ArticleDetail, ArticleDraft, VersionDetail } from '@dzenwriter/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchArticle, saveDraft } from '../api/articles';
import { checkVersion, fetchVersion, fetchVersions } from '../api/versions';
import { EditorPage } from './EditorPage';

const USER = vi.hoisted(() => ({
  id: '00000000-0000-4000-8000-000000000001',
  login: 'anna',
  name: 'Анна',
  role: 'admin' as const,
}));

vi.mock('../api/articles', () => ({
  fetchArticle: vi.fn(),
  generateTitleOptions: vi.fn(),
  saveDraft: vi.fn(),
  transitionArticle: vi.fn(),
}));

vi.mock('../api/versions', () => ({
  checkVersion: vi.fn(),
  fetchVersion: vi.fn(),
  fetchVersions: vi.fn(),
  rollbackVersion: vi.fn(),
  saveVersion: vi.fn(),
}));

vi.mock('../api/generation', () => ({
  startGeneration: vi.fn(),
}));

vi.mock('../api/reviews', () => ({
  createReviewComment: vi.fn(),
  fetchReviewComments: vi.fn().mockResolvedValue({ items: [] }),
  resolveReviewComment: vi.fn(),
}));

vi.mock('../features/editor/MarkdownEditor', async () => {
  const React = await import('react');
  return {
    MarkdownEditor: ({
      value,
      onChange,
    }: {
      readonly value: string;
      readonly onChange: (value: string) => void;
    }) =>
      React.createElement('textarea', {
        'aria-label': 'Текст статьи',
        value,
        onChange: (event: { target: { value: string } }) => onChange(event.target.value),
      }),
  };
});

vi.mock('../features/editor/ArticlePreview', () => ({
  ArticlePreview: () => null,
}));

vi.mock('../session/SessionContext', () => ({
  useSession: () => ({
    state: { phase: 'authenticated', user: USER },
    signOut: vi.fn(),
  }),
}));

const mockedFetchArticle = vi.mocked(fetchArticle);
const mockedFetchVersions = vi.mocked(fetchVersions);
const mockedFetchVersion = vi.mocked(fetchVersion);
const mockedSaveDraft = vi.mocked(saveDraft);
const mockedCheckVersion = vi.mocked(checkVersion);

const ARTICLE_ID = '00000000-0000-4000-8000-0000000000a1';

const VERSION: VersionDetail = {
  number: 1,
  origin: 'manual',
  title: 'Заголовок версии',
  articleMarkdown: 'Текст сохранённой версии.',
  seoTitle: 'SEO версии',
  tags: [],
  description: '',
  imagePrompt: '',
  advertisingLabel: false,
  disclaimerText: null,
  claims: [],
  checks: [],
  styleVersion: 1,
  promptVersion: 'manual',
  generationRunId: null,
  createdAt: '2026-10-21T10:00:00.000Z',
  createdBy: 'anna',
};

const DRAFT: ArticleDraft = {
  articleId: ARTICLE_ID,
  title: 'Заголовок черновика',
  articleMarkdown: 'Текст серверного черновика.',
  seoTitle: 'SEO черновика',
  tags: ['ии'],
  description: 'Описание черновика',
  imagePrompt: 'Обложка черновика',
  advertisingLabel: false,
  disclaimerText: null,
  claims: [],
  version: 5,
  updatedAt: '2026-10-22T11:00:00.000Z',
  updatedBy: USER.id,
};

const DETAIL = {
  id: ARTICLE_ID,
  topic: 'Регулирование ИИ',
  keywords: ['ИИ'],
  title: null,
  brief: null,
  styleId: 'industry-news',
  styleName: 'Новости индустрии',
  format: 'news',
  tone: 'neutral',
  lengthMin: 4000,
  lengthMax: 6000,
  productId: null,
  status: 'drafting',
  owner: { id: USER.id, login: USER.login, name: USER.name },
  reviewer: null,
  plannedAt: null,
  currentVersionNumber: 1,
  blockingChecks: 0,
  version: 7,
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-22T11:00:00.000Z',
  requirements: [],
  transitions: [],
  versions: [],
  reviews: [],
  publications: [],
  facts: [],
  checks: [],
  generation: { allowed: true, reason: null, outOfFocus: false, confirmed: false },
  draft: DRAFT,
} as unknown as ArticleDetail;

function renderEditor() {
  mockedFetchArticle.mockResolvedValue(DETAIL);
  mockedFetchVersions.mockResolvedValue({ items: [] });
  mockedFetchVersion.mockResolvedValue(VERSION);
  mockedCheckVersion.mockResolvedValue({ checks: [], claims: [] });
  mockedSaveDraft.mockResolvedValue({
    ...DRAFT,
    articleMarkdown: 'Новая правка',
    version: 6,
    updatedAt: '2026-10-22T11:05:00.000Z',
  });

  render(
    <MemoryRouter initialEntries={[`/articles/${ARTICLE_ID}/edit`]}>
      <Routes>
        <Route path="/articles/:id/edit" element={<EditorPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('редактор и серверные черновики', () => {
  it('открывает текст из черновика, а не из текущей версии', async () => {
    renderEditor();

    const textarea = (await screen.findByLabelText('Текст статьи')) as HTMLTextAreaElement;
    expect(textarea.value).toBe('Текст серверного черновика.');
    expect(screen.getByLabelText('Заголовок')).toHaveProperty('value', 'Заголовок черновика');
    expect(screen.queryByDisplayValue('Текст сохранённой версии.')).toBeNull();
  });

  it('отправляет правку в saveDraft с версией черновика', async () => {
    renderEditor();
    const textarea = await screen.findByLabelText('Текст статьи');

    fireEvent.change(textarea, { target: { value: 'Новая правка' } });

    await waitFor(() => expect(mockedSaveDraft).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(mockedSaveDraft).toHaveBeenCalledWith(
      ARTICLE_ID,
      expect.objectContaining({
        expectedVersion: DRAFT.version,
        articleMarkdown: 'Новая правка',
      }),
    );
  });
});
