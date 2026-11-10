import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPilotMetrics } from '../api/pilot';
import { AdminPilotPage } from './AdminPilotPage';

vi.mock('../api/pilot', () => ({
  fetchPilotMetrics: vi.fn(),
}));

vi.mock('recharts', () => {
  const Wrapper = ({ children }: { readonly children?: ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Wrapper,
    BarChart: ({ children }: { readonly children?: ReactNode }) => (
      <div data-testid="bar-chart">{children}</div>
    ),
    PieChart: ({ children }: { readonly children?: ReactNode }) => (
      <div data-testid="pie-chart">{children}</div>
    ),
    Bar: () => null,
    Pie: () => null,
    Cell: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    Legend: () => null,
  };
});

const mockedFetch = vi.mocked(fetchPilotMetrics);

const METRICS = {
  period: { from: null, to: null },
  articles: {
    total: 2,
    approved: 1,
    reviewed: 1,
    approvalMedianHours: 26.5,
    approvedWithoutReturn: 1,
    approvedWithoutReturnShare: 1,
    gateCaught: 1,
    gateCaughtBeforeReviewShare: 1,
    withGeneratedVersion: 1,
    textChangedAfterGeneration: 1,
    textChangedAfterGenerationShare: 1,
    averageRating: 5,
    ratedArticles: 1,
    averageRubric: { accuracy: 5, style: 4, readability: 5, hooks: 3, cliches: 4 },
    rubricRatedArticles: 1,
  },
  generation: {
    runs: 3,
    succeeded: 1,
    needsInput: 1,
    failed: 1,
    cancelled: 0,
    needsInputShare: 0.3333,
    failureShare: 0.3333,
    questions: [{ question: 'Нужен источник', count: 1 }],
    costUsd: 0.21,
    costPerArticle: 0.21,
    byStyle: [
      {
        styleId: 'industry-news',
        styleName: 'Новости индустрии',
        totalRuns: 2,
        succeeded: 1,
        failed: 0,
        needsInput: 1,
        totalCostUsd: 0.21,
        avgLatencyMs: 1000,
      },
    ],
    byPromptVersion: [
      {
        promptVersion: 'sha256:abcdef1234567890',
        totalRuns: 2,
        succeeded: 1,
        failed: 0,
        needsInput: 1,
        totalCostUsd: 0.21,
      },
    ],
  },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('дашборд пилота', () => {
  it('показывает графики и таблицы по стилям и промптам', async () => {
    mockedFetch.mockResolvedValue(METRICS);
    render(<AdminPilotPage />);

    expect(await screen.findByRole('heading', { name: 'Статистика по стилям' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Статистика по промптам' })).toBeTruthy();
    expect(screen.getByTestId('bar-chart')).toBeTruthy();
    expect(screen.getByTestId('pie-chart')).toBeTruthy();
    expect(screen.getByText('Новости индустрии')).toBeTruthy();
    expect(screen.getByText('sha256:abcdef12345…')).toBeTruthy();
    expect(screen.getByText(/1\s000 мс/)).toBeTruthy();
  });

  it('на пустом периоде показывает заглушку вместо осей', async () => {
    mockedFetch.mockResolvedValue({
      ...METRICS,
      generation: {
        ...METRICS.generation,
        byStyle: [],
        byPromptVersion: [],
      },
    });
    render(<AdminPilotPage />);

    expect((await screen.findAllByText('Нет данных за выбранный период')).length).toBe(2);
    expect(screen.queryByTestId('bar-chart')).toBeNull();
    expect(screen.queryByTestId('pie-chart')).toBeNull();
  });
});
