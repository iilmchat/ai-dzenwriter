import { describe, expect, it } from 'vitest';
import { parseMetricsCsv, splitCsvLine } from '../src/metrics/csv-parser';

describe('разбор CSV метрик', () => {
  it('читает канонические колонки', () => {
    const csv = [
      'url,captured_on,views,reads,avg_read_seconds',
      'https://dzen.ru/a/one,2026-11-01,1200,340,95',
      'https://dzen.ru/a/two,2026-11-02,800,120,',
    ].join('\n');

    const parsed = parseMetricsCsv(csv);

    expect(parsed.skipped).toEqual([]);
    expect(parsed.rows).toEqual([
      {
        line: 2,
        url: 'https://dzen.ru/a/one',
        capturedOn: '2026-11-01',
        views: 1200,
        reads: 340,
        avgReadSeconds: 95,
      },
      {
        line: 3,
        url: 'https://dzen.ru/a/two',
        capturedOn: '2026-11-02',
        views: 800,
        reads: 120,
        avgReadSeconds: null,
      },
    ]);
  });

  it('понимает русские названия колонок и любой порядок', () => {
    const csv = [
      'Просмотры;Прочтения;Ссылка;Дата;Время чтения',
      '1200;340;https://dzen.ru/a/one;2026-11-01;95',
    ].join('\n');

    const parsed = parseMetricsCsv(csv);

    expect(parsed.rows).toHaveLength(0);
    expect(parsed.skipped[0]?.reason).toContain('Нет колонок');
  });

  it('разделяет по запятой и точке с запятой', () => {
    expect(splitCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
    expect(splitCsvLine('"a,b",c')).toEqual(['a,b', 'c']);
    expect(splitCsvLine('"a""b",c')).toEqual(['a"b', 'c']);
  });

  it('пропускает плохие строки с причиной и номером', () => {
    const csv = [
      'url,captured_on,views,reads',
      'https://dzen.ru/a/one,2026-11-01,1200,340',
      ',2026-11-02,10,2',
      'https://dzen.ru/a/two,вчера,10,2',
      'https://dzen.ru/a/three,2026-11-03,много,2',
      'https://dzen.ru/a/four,2026-11-04,10,2',
    ].join('\n');

    const parsed = parseMetricsCsv(csv);

    expect(parsed.rows).toHaveLength(2);
    expect(parsed.skipped).toEqual([
      { line: 3, reason: 'Пустая ссылка' },
      { line: 4, reason: 'Некорректная дата: вчера' },
      { line: 5, reason: 'Просмотры — не целое число' },
    ]);
  });

  it('пустой файл не роняет разбор', () => {
    expect(parseMetricsCsv('')).toEqual({
      rows: [],
      skipped: [{ line: 1, reason: 'Файл пуст' }],
    });
  });

  it('пустые строки между строками пропускаются', () => {
    const csv = [
      'url,captured_on,views,reads',
      '',
      'https://dzen.ru/a/one,2026-11-01,10,2',
      '',
    ].join('\n');

    const parsed = parseMetricsCsv(csv);

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.line).toBe(3);
  });
});
