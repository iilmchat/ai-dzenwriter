import type { CalendarItem } from '@dzenwriter/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchCalendar } from '../api/calendar';
import { CalendarPage } from './CalendarPage';

vi.mock('../api/calendar', () => ({
  fetchCalendar: vi.fn(),
}));

const mockedFetch = vi.mocked(fetchCalendar);

const ANNA = '00000000-0000-4000-8000-000000000001';
const BORIS = '00000000-0000-4000-8000-000000000002';

function item(
  id: string,
  topic: string,
  ownerId: string,
  ownerName: string,
  plannedAt: string,
): CalendarItem {
  return {
    id,
    topic,
    status: 'scheduled',
    ownerId,
    ownerName,
    plannedAt,
    styleId: 'industry-news',
  };
}

const RESPONSE = {
  items: [
    item(
      '00000000-0000-4000-8000-0000000000a1',
      'Первый материал',
      ANNA,
      'Анна',
      '2026-11-05T09:00:00.000Z',
    ),
    item(
      '00000000-0000-4000-8000-0000000000a2',
      'Второй материал',
      BORIS,
      'Борис',
      '2026-11-05T12:00:00.000Z',
    ),
    item(
      '00000000-0000-4000-8000-0000000000a3',
      'Третий материал',
      ANNA,
      'Анна',
      '2026-11-05T15:00:00.000Z',
    ),
    item(
      '00000000-0000-4000-8000-0000000000a4',
      'Материал на двадцатое',
      BORIS,
      'Борис',
      '2026-11-20T09:00:00.000Z',
    ),
  ],
  authorLoad: [
    { ownerId: ANNA, ownerName: 'Анна', count: 2 },
    { ownerId: BORIS, ownerName: 'Борис', count: 2 },
  ],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPage() {
  render(
    <MemoryRouter>
      <CalendarPage initialMonth="2026-11" />
    </MemoryRouter>,
  );
}

describe('страница календаря', () => {
  it('рисует сетку месяца и карточки статей', async () => {
    mockedFetch.mockResolvedValue(RESPONSE);
    renderPage();

    expect(await screen.findByRole('heading', { name: /Ноябрь 2026/ })).toBeTruthy();
    expect(mockedFetch).toHaveBeenCalledWith('2026-11');
    expect(screen.getByText('Пн')).toBeTruthy();
    expect(screen.getByText('Первый материал')).toBeTruthy();
    expect(screen.getByText('Второй материал')).toBeTruthy();
    expect(screen.getByText('+1 ещё')).toBeTruthy();
    expect(screen.getByText('Первый материал').closest('a')?.getAttribute('href')).toBe(
      '/articles/00000000-0000-4000-8000-0000000000a1',
    );
  });

  it('показывает загрузку авторов', async () => {
    mockedFetch.mockResolvedValue(RESPONSE);
    renderPage();

    const heading = await screen.findByText('Загрузка авторов');
    expect(heading).toBeTruthy();
    const section = heading.closest('section');
    if (!section) {
      throw new Error('Нет блока загрузки авторов');
    }
    expect(within(section).getByText('Анна')).toBeTruthy();
    expect(within(section).getByText('Борис')).toBeTruthy();
    expect(within(section).getAllByText('2')).toHaveLength(2);
  });

  it('переключает месяц вперёд и назад', async () => {
    mockedFetch.mockResolvedValue(RESPONSE);
    renderPage();
    await screen.findByRole('heading', { name: /Ноябрь 2026/ });

    fireEvent.click(screen.getByRole('button', { name: 'Следующий месяц' }));

    await waitFor(() => expect(mockedFetch).toHaveBeenLastCalledWith('2026-12'));
    expect(await screen.findByRole('heading', { name: /Декабрь 2026/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));

    await waitFor(() => expect(mockedFetch).toHaveBeenLastCalledWith('2026-11'));
    expect(await screen.findByRole('heading', { name: /Ноябрь 2026/ })).toBeTruthy();
  });

  it('на пустом месяце показывает пустую загрузку авторов', async () => {
    mockedFetch.mockResolvedValue({ items: [], authorLoad: [] });
    renderPage();

    expect(await screen.findByText('В этом месяце плановых статей нет.')).toBeTruthy();
  });
});
