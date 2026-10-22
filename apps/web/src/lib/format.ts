// Все даты показываем и вводим по Москве: так задано в дизайне (UTC в БД, Europe/Moscow в UI).
const MOSCOW = 'Europe/Moscow';
const MOSCOW_OFFSET = '+03:00';

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: MOSCOW,
});

const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: MOSCOW,
});

const isoDateFormatter = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: MOSCOW,
});

export function formatDate(iso: string): string {
  return dateFormatter.format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return dateTimeFormatter.format(new Date(iso));
}

// Плановая дата без времени: по умолчанию 09:00 по Москве.
export function dateToPlannedAt(date: string): string | undefined {
  return date ? new Date(`${date}T09:00:00${MOSCOW_OFFSET}`).toISOString() : undefined;
}

export function plannedAtToDate(iso: string | null): string {
  return iso ? isoDateFormatter.format(new Date(iso)) : '';
}

// Фильтр по дате включает весь выбранный день по Москве.
export function startOfDayIso(date: string): string {
  return new Date(`${date}T00:00:00${MOSCOW_OFFSET}`).toISOString();
}

export function endOfDayIso(date: string): string {
  return new Date(`${date}T23:59:59${MOSCOW_OFFSET}`).toISOString();
}

export function parseKeywords(value: string): string[] {
  return value
    .split(',')
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length > 0);
}
