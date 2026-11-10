import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMetrics } from '../api/metrics';
import { fetchPublications } from '../api/publications';
import { MetricsPage } from './MetricsPage';

vi.mock('../api/metrics', () => ({
  fetchMetrics: vi.fn(),
  createMetric: vi.fn(),
  importMetrics: vi.fn(),
}));

vi.mock('../api/publications', () => ({
  fetchPublications: vi.fn(),
}));

vi.mock('recharts', () => {
  const Wrapper = ({ children }: { readonly children?: ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Wrapper,
    LineChart: ({ children }: { readonly children?: ReactNode }) => (
      <div data-testid="line-chart">{children}</div>
    ),
    Line: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    Legend: () => null,
  };
});

const mockedFetch = vi.mocked(fetchMetrics);
const mockedPublications = vi.mocked(fetchPublications);

const FIRST_ARTICLE = '00000000-0000-4000-8000-0000000000a1';
const SECOND_ARTICLE = '00000000-0000-4000-8000-0000000000a2';

const RESPONSE = {
  items: [
    {
      id: '00000000-0000-4000-8000-000000000001',
      articleId: FIRST_ARTICLE,
      topic: 'Первый материал',
      externalUrl: 'https://dzen.ru/a/first',
      capturedOn: '2026-11-02',
      views: 1500,
      reads: 450,
      avgReadSeconds: 90,
      source: 'manual' as const,
      createdAt: '2026-11-02T10:00:00.000Z',
      createdBy: 'anna',
    },
    {
      id: '00000000-0000-4000-8000-000000000002',
      articleId: SECOND_ARTICLE,
      topic: 'Второй материал',
      externalUrl: 'https://dzen.ru/a/second',
      capturedOn: '2026-11-02',
      views: 800,
      reads: 200,
      avgReadSeconds: 70,
      source: 'manual' as const,
      createdAt: '2026-11-02T10:00:00.000Z',
      createdBy: 'anna',
    },
  ],
  availablePublications: [
    { id: FIRST_ARTICLE, title: 'Первый материал', externalUrl: 'https://dzen.ru/a/first' },
    { id: SECOND_ARTICLE, title: 'Второй материал', externalUrl: 'https://dzen.ru/a/second' },
  ],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setup(response = RESPONSE) {
  mockedFetch.mockResolvedValue(response);
  mockedPublications.mockResolvedValue({ items: [] });
  render(<MetricsPage />);
}

describe('страница метрик', () => {
  it('показывает график, фильтры и публикации', async () => {
    setup();

    expect(await screen.findByTestId('line-chart')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Просмотры по дням' })).toBeTruthy();
    expect(screen.getByLabelText('С даты')).toBeTruthy();
    expect(screen.getByLabelText('По дату')).toBeTruthy();
    expect(screen.getByLabelText('Первый материал')).toBeTruthy();
    expect(screen.getByLabelText('Второй материал')).toBeTruthy();
  });

  it('передаёт выбранные публикации и даты в API', async () => {
    setup();
    await screen.findByTestId('line-chart');

    fireEvent.click(screen.getByLabelText('Первый материал'));
    fireEvent.click(screen.getByRole('button', { name: 'Показать' }));

    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(2));
    expect(mockedFetch.mock.calls.at(-1)?.[0]).toMatchObject({
      publicationIds: [FIRST_ARTICLE],
    });
  });

  it('сравнение загружает предыдущий период', async () => {
    setup();
    await screen.findByTestId('line-chart');

    fireEvent.click(screen.getByRole('button', { name: 'Сравнить с предыдущим периодом' }));

    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(3));
    const ranges = mockedFetch.mock.calls.map(([filters]) => ({
      from: filters?.from,
      to: filters?.to,
    }));
    expect(new Set(ranges.map((range) => `${range.from}:${range.to}`)).size).toBe(2);
    expect(
      screen
        .getByRole('button', { name: 'Сравнить с предыдущим периодом' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('без данных показывает заглушку вместо графика', async () => {
    setup({ items: [], availablePublications: [] });

    expect(await screen.findByText('Нет данных за выбранный период')).toBeTruthy();
    expect(screen.queryByTestId('line-chart')).toBeNull();
  });
});
