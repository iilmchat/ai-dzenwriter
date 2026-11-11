import { articleDetailSchema, type ArticleDetail } from '@dzenwriter/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutopilotPanel } from './AutopilotPanel';

const api = vi.hoisted(() => ({
  startAutopilot: vi.fn(),
  fetchArticle: vi.fn(),
}));

vi.mock('../../api/autopilot', () => ({ startAutopilot: api.startAutopilot }));
vi.mock('../../api/articles', () => ({ fetchArticle: api.fetchArticle }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeArticle(status: 'approved' | 'draft' = 'approved'): ArticleDetail {
  return articleDetailSchema.parse({
    id: '11111111-1111-4111-8111-111111111111',
    topic: 'Регулирование ИИ в ЕС',
    keywords: ['ИИ'],
    title: null,
    brief: '## План',
    styleId: 'industry-news',
    styleName: 'Новости индустрии',
    format: 'news',
    tone: 'neutral',
    lengthMin: 4000,
    lengthMax: 6000,
    productId: null,
    status: 'drafting',
    owner: { id: '22222222-2222-4222-8222-222222222222', login: 'anna', name: null },
    reviewer: null,
    plannedAt: null,
    currentVersionNumber: 1,
    blockingChecks: 0,
    version: 3,
    createdAt: '2026-10-22T10:00:00.000Z',
    updatedAt: '2026-10-22T10:00:00.000Z',
    requirements: [],
    transitions: [],
    versions: [],
    reviews: [],
    publications: [],
    facts: [
      {
        factId: '33333333-3333-4333-8333-333333333333',
        label: 'F1',
        type: 'news_source',
        status,
        text: 'ЕС принял пакет правил по ИИ.',
        sourceName: 'Reuters',
        sourceUrl: 'https://example.com/news',
        sourcePublishedAt: '2026-10-20',
      },
    ],
    checks: [],
    generation: { allowed: true, reason: null, outOfFocus: false, confirmed: false },
    draft: null,
  });
}

describe('панель автопилота', () => {
  it('запускает цикл и показывает прогресс по итерациям', async () => {
    const onChanged = vi.fn();
    const updated = makeArticle();
    api.fetchArticle.mockResolvedValue(updated);
    api.startAutopilot.mockImplementation(async function* () {
      yield {
        type: 'stage',
        stage: 'generate',
        message: 'Итерация 1: генерация текста',
        iteration: 1,
      };
      yield {
        type: 'stage',
        stage: 'checks',
        message: 'Итерация 1: блокирующих 1, предупреждений 6',
        iteration: 1,
      };
      yield {
        type: 'stage',
        stage: 'refine',
        message: 'Итерация 2: переписывание по замечаниям',
        iteration: 2,
      };
      yield { type: 'result', versionNumber: 2, iterations: 2, blocking: 0, warnings: 1 };
    });

    render(<AutopilotPanel article={makeArticle()} canRun onChanged={onChanged} />);

    fireEvent.click(screen.getByRole('button', { name: 'Запустить Автопилот' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Прогресс автопилота').textContent).toContain(
        'Итерация 1: генерация текста',
      );
    });
    expect(screen.getByLabelText('Прогресс автопилота').textContent).toContain(
      'Итерация 2: переписывание по замечаниям',
    );
    await waitFor(() => {
      expect(screen.getByText(/блокирующих 0/)).toBeTruthy();
    });
    expect(api.startAutopilot).toHaveBeenCalledWith(
      updated.id,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(onChanged).toHaveBeenCalledWith(updated);
  });

  it('не показывается, пока факты не одобрены', () => {
    render(<AutopilotPanel article={makeArticle('draft')} canRun onChanged={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Запустить Автопилот' })).toBeNull();
  });
});
