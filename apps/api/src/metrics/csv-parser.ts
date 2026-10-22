import { METRIC_CSV_COLUMNS } from '@dzenwriter/shared';

export interface ParsedMetricRow {
  readonly line: number;
  readonly url: string;
  readonly capturedOn: string;
  readonly views: number;
  readonly reads: number;
  readonly avgReadSeconds: number | null;
}

export interface CsvProblem {
  readonly line: number;
  readonly reason: string;
}

export interface ParsedMetricsCsv {
  readonly rows: readonly ParsedMetricRow[];
  readonly skipped: readonly CsvProblem[];
}

type ColumnKey = keyof typeof METRIC_CSV_COLUMNS;

// Разбор CSV метрик: первая непустая строка — заголовок, имена колонок распознаются
// по каноническим названиям и русским синонимам. Плохие строки пропускаются с причиной.
export function parseMetricsCsv(csv: string): ParsedMetricsCsv {
  const lines = csv.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.trim().length > 0);
  if (headerIndex < 0) {
    return { rows: [], skipped: [{ line: 1, reason: 'Файл пуст' }] };
  }

  const header = splitCsvLine(lines[headerIndex] ?? '');
  const columns = mapColumns(header);
  const missing = (['url', 'capturedOn', 'views', 'reads'] as const).filter(
    (key) => columns[key] === undefined,
  );
  if (missing.length > 0) {
    const expected = Object.values(METRIC_CSV_COLUMNS).flat().join(', ');
    return {
      rows: [],
      skipped: [
        {
          line: headerIndex + 1,
          reason: `Нет колонок: ${missing.join(', ')}. Ожидаются: ${expected}`,
        },
      ],
    };
  }

  const rows: ParsedMetricRow[] = [];
  const skipped: CsvProblem[] = [];

  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.trim().length === 0) {
      continue;
    }
    const number = index + 1;
    const cells = splitCsvLine(line);
    const url = (cells[columns.url as number] ?? '').trim();
    if (url.length === 0) {
      skipped.push({ line: number, reason: 'Пустая ссылка' });
      continue;
    }
    const capturedOn = (cells[columns.capturedOn as number] ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(capturedOn)) {
      skipped.push({ line: number, reason: `Некорректная дата: ${capturedOn}` });
      continue;
    }
    const views = toInteger(cells[columns.views as number]);
    if (views === null) {
      skipped.push({ line: number, reason: 'Просмотры — не целое число' });
      continue;
    }
    const reads = toInteger(cells[columns.reads as number]);
    if (reads === null) {
      skipped.push({ line: number, reason: 'Прочтения — не целое число' });
      continue;
    }
    const avgCell =
      columns.avgReadSeconds === undefined ? '' : (cells[columns.avgReadSeconds] ?? '').trim();
    const avgReadSeconds = avgCell.length === 0 ? null : toInteger(avgCell);
    if (avgReadSeconds === null && avgCell.length > 0) {
      skipped.push({ line: number, reason: 'Время чтения — не целое число' });
      continue;
    }

    rows.push({ line: number, url, capturedOn, views, reads, avgReadSeconds });
  }

  return { rows, skipped };
}

// Имена колонок сопоставляются без учёта регистра и лишних пробелов.
function mapColumns(header: readonly string[]): Partial<Record<ColumnKey, number>> {
  const columns: Partial<Record<ColumnKey, number>> = {};
  header.forEach((name, index) => {
    const normalized = name.trim().toLowerCase();
    for (const key of Object.keys(METRIC_CSV_COLUMNS) as ColumnKey[]) {
      if (columns[key] !== undefined) {
        continue;
      }
      const aliases = METRIC_CSV_COLUMNS[key] as readonly string[];
      if (aliases.some((alias) => alias.toLowerCase() === normalized)) {
        columns[key] = index;
      }
    }
  });
  return columns;
}

// Разделение строки CSV: запятая вне кавычек; удвоенная кавычка внутри кавычек.
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (char === ',' && !quoted) {
      cells.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

function toInteger(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const cleaned = value.trim().replace(/\s/g, '');
  if (cleaned.length === 0) {
    return null;
  }
  if (!/^\d+$/.test(cleaned)) {
    return null;
  }
  return Number(cleaned);
}
