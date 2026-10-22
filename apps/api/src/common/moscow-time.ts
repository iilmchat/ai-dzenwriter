// Москва живёт без летнего времени: UTC+3 круглый год.
const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;

// Начало суток по Москве в UTC. Суточные лимиты считаются по нему.
export function moscowDayStart(now: Date): Date {
  const shifted = new Date(now.getTime() + MOSCOW_OFFSET_MS);
  const start = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return new Date(start - MOSCOW_OFFSET_MS);
}

// Сегодняшняя дата по Москве: её видит модель в блоке «Сегодня».
export function todayInMoscow(now: Date): string {
  return new Date(now.getTime() + MOSCOW_OFFSET_MS).toISOString().slice(0, 10);
}
