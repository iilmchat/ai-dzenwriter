import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CalendarService } from '../src/calendar/calendar.service';
import type { CalendarItemRow } from '../src/calendar/calendar.repository';
import { InMemoryCalendarRepository } from './support/in-memory-calendar.repository';

const ANNA = '00000000-0000-4000-8000-000000000001';
const BORIS = '00000000-0000-4000-8000-000000000002';
const STYLE = 'industry-news';

function item(
  id: string,
  topic: string,
  ownerId: string,
  ownerName: string,
  plannedAt: string,
  status: CalendarItemRow['status'] = 'scheduled',
): CalendarItemRow {
  return {
    id,
    topic,
    status,
    ownerId,
    ownerName,
    plannedAt: new Date(plannedAt),
    styleId: STYLE,
  };
}

function setup() {
  const repository = new InMemoryCalendarRepository([
    item(
      '00000000-0000-4000-8000-0000000000a1',
      'Первый материал',
      ANNA,
      'Анна',
      '2026-11-05T09:00:00Z',
    ),
    item(
      '00000000-0000-4000-8000-0000000000a2',
      'Второй материал',
      ANNA,
      'Анна',
      '2026-11-20T09:00:00Z',
    ),
    item(
      '00000000-0000-4000-8000-0000000000a3',
      'Третий материал',
      BORIS,
      'Борис',
      '2026-11-25T09:00:00Z',
    ),
    item(
      '00000000-0000-4000-8000-0000000000a4',
      'Опубликованный материал',
      ANNA,
      'Анна',
      '2026-11-10T09:00:00Z',
      'published',
    ),
    item(
      '00000000-0000-4000-8000-0000000000a5',
      'Архивный материал',
      BORIS,
      'Борис',
      '2026-11-15T09:00:00Z',
      'archived',
    ),
    item(
      '00000000-0000-4000-8000-0000000000a6',
      'Декабрьский материал',
      ANNA,
      'Анна',
      '2026-12-01T09:00:00Z',
    ),
  ]);
  return new CalendarService(repository);
}

describe('календарь плановых дат', () => {
  it('возвращает статьи месяца и считает загрузку авторов', async () => {
    const service = setup();

    const response = await service.getCalendar('2026-11');

    expect(response.items.map((item) => item.topic)).toEqual([
      'Первый материал',
      'Второй материал',
      'Третий материал',
    ]);
    expect(response.items[0]?.plannedAt).toBe('2026-11-05T09:00:00.000Z');
    expect(response.authorLoad).toEqual([
      { ownerId: ANNA, ownerName: 'Анна', count: 2 },
      { ownerId: BORIS, ownerName: 'Борис', count: 1 },
    ]);
  });

  it('исключает published и archived и материалы соседних месяцев', async () => {
    const service = setup();

    const response = await service.getCalendar('2026-11');

    expect(response.items).toHaveLength(3);
    expect(response.items.some((item) => item.status === 'published')).toBe(false);
    expect(response.items.some((item) => item.status === 'archived')).toBe(false);
    expect(response.items.some((item) => item.topic === 'Декабрьский материал')).toBe(false);
  });

  it('пустой месяц возвращает пустые списки', async () => {
    const service = setup();

    expect(await service.getCalendar('2027-01')).toEqual({
      items: [],
      authorLoad: [],
    });
  });

  it('некорректный месяц отклоняется', async () => {
    const service = setup();

    await expect(service.getCalendar('2026-13')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.getCalendar('ноябрь')).rejects.toBeInstanceOf(BadRequestException);
  });
});
