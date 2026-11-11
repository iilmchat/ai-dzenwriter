import type {
  ArticleDetail,
  ArticleDraft,
  SaveVersionResponse,
  VersionCheck,
  VersionDetail,
} from '@dzenwriter/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmCheck, fetchArticle, saveDraft } from '../api/articles';
import { ApiError } from '../api/client';
import { checkVersion, fetchVersion, fetchVersions, saveVersion } from '../api/versions';
import { EditorPage, findCheckIndex, mergeConfirmedChecks } from './EditorPage';

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
  confirmCheck: vi.fn(),
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
const mockedSaveVersion = vi.mocked(saveVersion);
const mockedCheckVersion = vi.mocked(checkVersion);
const mockedConfirmCheck = vi.mocked(confirmCheck);

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

  it('отправляет маркировку рекламы при сохранении версии', async () => {
    renderEditor();
    const checkbox = (await screen.findByLabelText(/маркировку рекламы/)) as HTMLInputElement;

    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    mockedSaveVersion.mockResolvedValue({
      version: { ...VERSION, number: 4, advertisingLabel: true },
      article: { id: ARTICLE_ID, version: 8, currentVersionNumber: 4 },
    } as SaveVersionResponse);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить версию' }));

    await waitFor(() =>
      expect(mockedSaveVersion).toHaveBeenCalledWith(
        ARTICLE_ID,
        expect.objectContaining({ advertisingLabel: true }),
      ),
    );
  });
});

describe('редактор: проверки и версия', () => {
  const CHECK: VersionCheck = {
    id: 'numbers_must_map_to_facts',
    severity: 'block',
    message: 'Число 42 не найдено в фактах',
    start: 10,
    end: 12,
    excerpt: '42',
  };

  it('переносит подтверждения на новые результаты Live Check', () => {
    const previous: VersionCheck[] = [
      {
        ...CHECK,
        decision: 'confirmed',
        comment: 'Число 42 — номер пункта',
        confirmedBy: USER.id,
        confirmedAt: '2026-10-22T11:00:00.000Z',
      },
    ];
    const next: VersionCheck[] = [
      { ...CHECK },
      { ...CHECK, id: 'paragraph_length', message: 'Абзац длинный', start: 20, end: 30 },
    ];

    const merged = mergeConfirmedChecks(previous, next);

    expect(merged[0]).toMatchObject({
      id: CHECK.id,
      decision: 'confirmed',
      comment: 'Число 42 — номер пункта',
    });
    expect(merged[1]?.decision).toBeUndefined();
  });

  it('переносит подтверждение по excerpt при сдвиге позиции', () => {
    const previous: VersionCheck[] = [{ ...CHECK, decision: 'confirmed', comment: 'Проверено' }];
    const next: VersionCheck[] = [{ ...CHECK, start: 14, end: 16 }];

    expect(mergeConfirmedChecks(previous, next)[0]).toMatchObject({
      decision: 'confirmed',
      comment: 'Проверено',
    });
  });

  it('находит индекс проверки в сохранённой версии, даже если Live Check перестроил список', () => {
    const first: VersionCheck = {
      ...CHECK,
      id: 'paragraph_length',
      message: 'Абзац длинный',
      start: 1,
      end: 4,
      excerpt: 'Текст',
    };
    const shifted: VersionCheck = { ...CHECK, start: 14, end: 16 };

    expect(findCheckIndex([first, CHECK], shifted)).toBe(1);
  });

  it('при 409 перезагружает данные и не показывает красную ошибку', async () => {
    mockedFetchArticle.mockResolvedValue(DETAIL);
    mockedFetchVersions.mockResolvedValue({ items: [] });
    mockedFetchVersion.mockResolvedValue({ ...VERSION, checks: [CHECK] });
    mockedCheckVersion.mockResolvedValue({ checks: [CHECK], claims: [] });
    mockedConfirmCheck.mockRejectedValue(new ApiError(409, 'Проверка уже подтверждена'));

    render(
      <MemoryRouter initialEntries={[`/articles/${ARTICLE_ID}/edit`]}>
        <Routes>
          <Route path="/articles/:id/edit" element={<EditorPage />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Подтвердить' }));
    fireEvent.change(screen.getByLabelText('Почему проверку можно снять'), {
      target: { value: 'Число 42 — номер пункта правил' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));

    await waitFor(() =>
      expect(screen.getByText('Проверка уже подтверждена на сервере.')).toBeTruthy(),
    );
    await waitFor(() => expect(mockedFetchArticle).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('обновляет номер версии в шапке при открытии старой версии', async () => {
    mockedFetchArticle.mockResolvedValue({
      ...DETAIL,
      currentVersionNumber: 2,
      draft: null,
    });
    mockedFetchVersions.mockResolvedValue({
      items: [
        {
          number: 2,
          origin: 'manual',
          advertisingLabel: false,
          blockingChecks: 0,
          createdAt: '2026-10-22T10:00:00.000Z',
          createdBy: 'anna',
        },
        {
          number: 1,
          origin: 'generated',
          advertisingLabel: false,
          blockingChecks: 0,
          createdAt: '2026-10-21T10:00:00.000Z',
          createdBy: 'anna',
        },
      ],
    });
    mockedFetchVersion.mockImplementation(async (_id, number) => ({
      ...VERSION,
      number,
      title: `Заголовок версии ${number}`,
      articleMarkdown: `Текст версии ${number}.`,
    }));
    mockedCheckVersion.mockResolvedValue({ checks: [], claims: [] });

    render(
      <MemoryRouter initialEntries={[`/articles/${ARTICLE_ID}/edit`]}>
        <Routes>
          <Route path="/articles/:id/edit" element={<EditorPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/версия 2 ·/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'История версий' }));

    const row = screen.getByText(/Версия 1:/).closest('li');
    if (!row) {
      throw new Error('Нет строки версии 1');
    }
    fireEvent.click(within(row).getByRole('button', { name: 'Открыть' }));

    await waitFor(() => expect(mockedFetchVersion).toHaveBeenCalledWith(ARTICLE_ID, 1));
    expect(await screen.findByText(/версия 1 ·/)).toBeTruthy();
    expect(screen.queryByText(/версия 2 ·/)).toBeNull();
  });
});
