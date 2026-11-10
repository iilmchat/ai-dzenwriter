import type { AvailablePublication, MetricSnapshot, PublicationItem } from '@dzenwriter/shared';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { errorMessage } from '../api/client';
import { createMetric, fetchMetrics, importMetrics, type MetricsFilters } from '../api/metrics';
import { fetchPublications } from '../api/publications';
import { formatDate } from '../lib/format';
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  INPUT_CLASS,
  LABEL_CLASS,
  PANEL_CLASS,
} from '../shared/ui/classes';
import { Notice } from '../shared/ui/Notice';
import { Skeleton } from '../shared/ui/Skeleton';

const DAY_MS = 24 * 60 * 60 * 1000;
type MetricKind = 'views' | 'reads';

const METRIC_LABELS: Record<MetricKind, string> = {
  views: 'Просмотры',
  reads: 'Прочтения',
};

const CHART_COLORS = [
  'var(--color-primary)',
  'var(--color-tertiary)',
  'var(--color-error)',
  'var(--color-secondary-container)',
  'var(--color-on-surface-variant)',
];

const TOOLTIP_STYLE = {
  backgroundColor: 'var(--color-surface-container)',
  border: '1px solid var(--color-outline-variant)',
  borderRadius: '12px',
  color: 'var(--color-on-surface)',
};

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);
}

function defaultFilters(): MetricsFilters {
  return {
    from: isoDaysAgo(29),
    to: isoDaysAgo(0),
    publicationIds: [],
  };
}

// Предыдущий такой же интервал: для пунктирных линий сравнения.
function previousPeriod(filters: MetricsFilters): MetricsFilters | null {
  if (!filters.from || !filters.to) {
    return null;
  }
  const from = Date.parse(`${filters.from}T00:00:00Z`);
  const to = Date.parse(`${filters.to}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    return null;
  }
  const days = Math.round((to - from) / DAY_MS) + 1;
  const previousTo = new Date(from - DAY_MS);
  const previousFrom = new Date(previousTo.getTime() - (days - 1) * DAY_MS);
  return {
    from: previousFrom.toISOString().slice(0, 10),
    to: previousTo.toISOString().slice(0, 10),
    publicationIds: filters.publicationIds,
  };
}

// Метрики публикаций: графики по дням, сравнение периодов, ручной ввод и импорт CSV.
export function MetricsPage() {
  const [filters, setFilters] = useState<MetricsFilters>(() => defaultFilters());
  const [applied, setApplied] = useState<MetricsFilters>(() => defaultFilters());
  const [snapshots, setSnapshots] = useState<MetricSnapshot[]>([]);
  const [previousSnapshots, setPreviousSnapshots] = useState<MetricSnapshot[]>([]);
  const [available, setAvailable] = useState<AvailablePublication[]>([]);
  const [publications, setPublications] = useState<PublicationItem[]>([]);
  const [metric, setMetric] = useState<MetricKind>('views');
  const [compare, setCompare] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [reloadKey, setReloadKey] = useState(0);
  const loadedOnce = useRef(false);

  useEffect(() => {
    let active = true;
    // Повторная загрузка после ввода метрик тихая: формы не исчезают на время запроса.
    if (!loadedOnce.current) {
      setLoading(true);
    }
    setError(undefined);
    const previous = compare ? previousPeriod(applied) : null;
    Promise.all([
      fetchMetrics(applied),
      previous === null ? Promise.resolve(null) : fetchMetrics(previous),
      fetchPublications(),
    ]).then(
      ([metrics, previousMetrics, published]) => {
        if (!active) {
          return;
        }
        setSnapshots(metrics.items);
        setAvailable(metrics.availablePublications);
        setPreviousSnapshots(previousMetrics?.items ?? []);
        setPublications(published.items);
        loadedOnce.current = true;
        setLoading(false);
      },
      (cause: unknown) => {
        if (active) {
          setError(errorMessage(cause));
          setLoading(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [applied, compare, reloadKey]);

  const chart = useMemo(
    () => buildChart(snapshots, previousSnapshots, available, applied.publicationIds ?? [], metric),
    [snapshots, previousSnapshots, available, applied.publicationIds, metric],
  );
  const comparison = useMemo(() => compareByArticle(snapshots), [snapshots]);

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setApplied({
      ...filters,
      publicationIds: [...(filters.publicationIds ?? [])],
    });
  }

  function togglePublication(id: string) {
    setFilters((current) => {
      const selected = current.publicationIds ?? [];
      return {
        ...current,
        publicationIds: selected.includes(id)
          ? selected.filter((item) => item !== id)
          : [...selected, id],
      };
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-bold">Метрики</h1>
        <p className="text-on-surface-variant">
          Просмотры, прочтения и время чтения из панели Дзена. Значения накопительные: снимок
          показывает, сколько у статьи было на дату снимка.
        </p>
      </header>

      {error !== undefined ? <Notice tone="error">{error}</Notice> : null}

      {loading ? (
        <section aria-busy="true" aria-label="Загрузка..." className={PANEL_CLASS}>
          <Skeleton width="14rem" height="1.5rem" />
          <Skeleton height="20rem" className="mt-4" />
        </section>
      ) : (
        <>
          <section aria-labelledby="metrics-filters-title" className={PANEL_CLASS}>
            <h2 id="metrics-filters-title" className="font-display text-lg font-bold">
              Фильтры
            </h2>
            <form className="mt-4 flex flex-col gap-4" onSubmit={apply}>
              <div className="flex flex-wrap items-end gap-4">
                <label className={LABEL_CLASS}>
                  С даты
                  <input
                    type="date"
                    className={INPUT_CLASS}
                    value={filters.from ?? ''}
                    onChange={(event) => setFilters({ ...filters, from: event.target.value })}
                  />
                </label>
                <label className={LABEL_CLASS}>
                  По дату
                  <input
                    type="date"
                    className={INPUT_CLASS}
                    value={filters.to ?? ''}
                    onChange={(event) => setFilters({ ...filters, to: event.target.value })}
                  />
                </label>
                <label className={LABEL_CLASS}>
                  Показатель
                  <select
                    className={INPUT_CLASS}
                    value={metric}
                    onChange={(event) => setMetric(event.target.value as MetricKind)}
                  >
                    <option value="views">Просмотры</option>
                    <option value="reads">Прочтения</option>
                  </select>
                </label>
                <button type="submit" className={BUTTON_PRIMARY}>
                  Показать
                </button>
                <button
                  type="button"
                  className={BUTTON_SECONDARY}
                  aria-pressed={compare}
                  onClick={() => setCompare((value) => !value)}
                >
                  Сравнить с предыдущим периодом
                </button>
              </div>

              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium">Публикации</legend>
                {available.length === 0 ? (
                  <p className="text-sm text-on-surface-variant">Опубликованных материалов нет.</p>
                ) : (
                  <div className="flex max-h-40 flex-wrap gap-x-4 gap-y-2 overflow-auto">
                    {available.map((item) => (
                      <label key={item.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={(filters.publicationIds ?? []).includes(item.id)}
                          onChange={() => togglePublication(item.id)}
                        />
                        {item.title}
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
            </form>
          </section>

          <MetricsChart data={chart.data} series={chart.series} metric={metric} compare={compare} />

          <ComparisonTable comparison={comparison} />

          <div className="grid gap-4 lg:grid-cols-2">
            <ManualEntry
              publications={publications}
              onSaved={() => setReloadKey((value) => value + 1)}
            />
            <CsvImport onImported={() => setReloadKey((value) => value + 1)} />
          </div>
        </>
      )}
    </div>
  );
}

interface ChartSeries {
  readonly id: string;
  readonly title: string;
}

interface ChartPoint {
  readonly date: string;
  readonly [key: string]: string | number;
}

interface ChartData {
  readonly data: readonly ChartPoint[];
  readonly series: readonly ChartSeries[];
}

// Собирает точки по датам: текущий период и, если включено, прошлый.
function buildChart(
  snapshots: readonly MetricSnapshot[],
  previousSnapshots: readonly MetricSnapshot[],
  available: readonly AvailablePublication[],
  selectedIds: readonly string[],
  metric: MetricKind,
): ChartData {
  const titles = new Map(available.map((item) => [item.id, item.title]));
  const presentIds = new Set(
    [...snapshots, ...previousSnapshots].map((snapshot) => snapshot.articleId),
  );
  for (const snapshot of [...snapshots, ...previousSnapshots]) {
    if (!titles.has(snapshot.articleId)) {
      titles.set(snapshot.articleId, snapshot.topic);
    }
  }
  const ids =
    selectedIds.length > 0 ? [...selectedIds] : [...presentIds].filter((id) => titles.has(id));
  const wanted = new Set(ids);
  const series = ids.map((id) => ({ id, title: titles.get(id) ?? id }));

  const points = new Map<string, Record<string, string | number>>();
  const pointFor = (date: string): Record<string, string | number> => {
    const existing = points.get(date);
    if (existing) {
      return existing;
    }
    const created: Record<string, string | number> = { date };
    points.set(date, created);
    return created;
  };

  for (const snapshot of snapshots) {
    if (wanted.has(snapshot.articleId)) {
      pointFor(snapshot.capturedOn)[`current_${snapshot.articleId}`] = snapshot[metric];
    }
  }
  for (const snapshot of previousSnapshots) {
    if (wanted.has(snapshot.articleId)) {
      pointFor(snapshot.capturedOn)[`previous_${snapshot.articleId}`] = snapshot[metric];
    }
  }

  return {
    data: [...points.values()]
      .map((point) => point as ChartPoint)
      .sort((left, right) => left.date.localeCompare(right.date)),
    series,
  };
}

interface TooltipEntry {
  readonly payload?: unknown;
}

interface MetricsTooltipProps {
  readonly active?: boolean;
  readonly label?: unknown;
  readonly payload?: readonly TooltipEntry[];
  readonly series: readonly ChartSeries[];
  readonly metric: MetricKind;
  readonly compare: boolean;
}

function MetricsTooltip({ active, label, payload, series, metric, compare }: MetricsTooltipProps) {
  if (!active || payload === undefined || payload.length === 0) {
    return null;
  }
  const raw = payload[0]?.payload;
  if (raw === null || typeof raw !== 'object') {
    return null;
  }
  const point = raw as Record<string, unknown>;
  const numberAt = (key: string): number | null => {
    const value = point[key];
    return typeof value === 'number' ? value : null;
  };

  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container p-3 text-sm">
      <p className="font-medium">{typeof label === 'string' ? formatDate(label) : ''}</p>
      <ul className="mt-2 flex flex-col gap-2">
        {series.map((item) => {
          const current = numberAt(`current_${item.id}`);
          const previous = numberAt(`previous_${item.id}`);
          if (current === null && previous === null) {
            return null;
          }
          const diff = compare && current !== null && previous !== null ? current - previous : null;
          return (
            <li key={item.id}>
              <p className="font-medium">{item.title}</p>
              <p className="text-on-surface-variant">
                {METRIC_LABELS[metric]}: {current ?? '—'}
                {compare ? ` · прошлый период: ${previous ?? '—'}` : ''}
              </p>
              {diff !== null ? (
                <p className={diff >= 0 ? 'text-tertiary' : 'text-error'}>
                  {diff >= 0 ? '+' : ''}
                  {diff}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function MetricsChart({
  data,
  series,
  metric,
  compare,
}: {
  readonly data: readonly ChartPoint[];
  readonly series: readonly ChartSeries[];
  readonly metric: MetricKind;
  readonly compare: boolean;
}) {
  return (
    <section aria-labelledby="metrics-chart-title" className={PANEL_CLASS}>
      <h2 id="metrics-chart-title" className="font-display text-lg font-bold">
        {METRIC_LABELS[metric]} по дням
      </h2>
      {data.length === 0 ? (
        <p className="mt-3 text-sm text-on-surface-variant">Нет данных за выбранный период</p>
      ) : (
        <div className="mt-3 h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={[...data]}>
              <CartesianGrid stroke="var(--color-outline-variant)" strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tickFormatter={(value: string) => formatDate(value)}
                tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12 }}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12 }}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                content={(props) => (
                  <MetricsTooltip
                    active={props.active}
                    label={props.label}
                    payload={props.payload as unknown as readonly TooltipEntry[]}
                    series={series}
                    metric={metric}
                    compare={compare}
                  />
                )}
              />
              <Legend />
              {compare
                ? series.map((item, index) => (
                    <Line
                      key={`previous-${item.id}`}
                      type="monotone"
                      dataKey={`previous_${item.id}`}
                      name={`${item.title} · прошлый период`}
                      stroke={CHART_COLORS[index % CHART_COLORS.length]}
                      strokeDasharray="6 4"
                      dot={false}
                      connectNulls
                    />
                  ))
                : null}
              {series.map((item, index) => (
                <Line
                  key={`current-${item.id}`}
                  type="monotone"
                  dataKey={`current_${item.id}`}
                  name={item.title}
                  stroke={CHART_COLORS[index % CHART_COLORS.length]}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

interface ComparisonRow {
  readonly articleId: string;
  readonly topic: string;
  readonly externalUrl: string | null;
  readonly capturedOn: string;
  readonly views: number;
  readonly reads: number;
  readonly avgReadSeconds: number | null;
  // Прирост за последний день: разница с предыдущим снимком.
  readonly viewsDelta: number;
  readonly readsDelta: number;
  // Доля прочтений от просмотров.
  readonly readRate: number | null;
}

// Сравнение материалов: последний снимок и прирост к предыдущему.
function compareByArticle(snapshots: readonly MetricSnapshot[]): ComparisonRow[] {
  const byArticle = new Map<string, MetricSnapshot[]>();
  for (const snapshot of snapshots) {
    const list = byArticle.get(snapshot.articleId) ?? [];
    list.push(snapshot);
    byArticle.set(snapshot.articleId, list);
  }

  const rows: ComparisonRow[] = [];
  for (const [articleId, list] of byArticle) {
    // Снимки приходят от новых к старым: первый — последний по дате.
    const latest = list[0];
    const previous = list[1];
    if (!latest) {
      continue;
    }
    rows.push({
      articleId,
      topic: latest.topic,
      externalUrl: latest.externalUrl,
      capturedOn: latest.capturedOn,
      views: latest.views,
      reads: latest.reads,
      avgReadSeconds: latest.avgReadSeconds,
      viewsDelta: latest.views - (previous?.views ?? 0),
      readsDelta: latest.reads - (previous?.reads ?? 0),
      readRate: latest.views > 0 ? Math.round((latest.reads / latest.views) * 100) : null,
    });
  }
  return rows.sort((left, right) => right.views - left.views);
}

function ComparisonTable({ comparison }: { readonly comparison: readonly ComparisonRow[] }) {
  return (
    <section aria-labelledby="comparison-title" className={PANEL_CLASS}>
      <h2 id="comparison-title" className="font-display text-lg font-bold">
        Сравнение материалов
      </h2>
      {comparison.length === 0 ? (
        <p className="mt-3 text-sm text-on-surface-variant">
          Метрик пока нет. Внесите цифры вручную или импортируйте CSV из панели Дзена.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-outline-variant">
                <th className="py-2 pr-3 font-medium">Материал</th>
                <th className="py-2 pr-3 font-medium">Снимок</th>
                <th className="py-2 pr-3 font-medium">Просмотры</th>
                <th className="py-2 pr-3 font-medium">Прочтения</th>
                <th className="py-2 pr-3 font-medium">Доля чтений</th>
                <th className="py-2 pr-3 font-medium">Время чтения</th>
                <th className="py-2 font-medium">За день</th>
              </tr>
            </thead>
            <tbody>
              {comparison.map((row) => (
                <tr key={row.articleId} className="border-b border-outline-variant">
                  <td className="py-2 pr-3">{row.topic}</td>
                  <td className="py-2 pr-3">{formatDate(row.capturedOn)}</td>
                  <td className="py-2 pr-3">
                    {row.views}
                    <span className="block text-xs text-on-surface-variant">
                      +{row.viewsDelta} за день
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    {row.reads}
                    <span className="block text-xs text-on-surface-variant">
                      +{row.readsDelta} за день
                    </span>
                  </td>
                  <td className="py-2 pr-3">{row.readRate === null ? '—' : `${row.readRate}%`}</td>
                  <td className="py-2 pr-3">
                    {row.avgReadSeconds === null ? '—' : `${row.avgReadSeconds} с`}
                  </td>
                  <td className="py-2">
                    {row.externalUrl === null ? (
                      '—'
                    ) : (
                      <a
                        href={row.externalUrl}
                        rel="noopener noreferrer"
                        target="_blank"
                        className="underline"
                      >
                        статья
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

interface ManualEntryProps {
  readonly publications: readonly PublicationItem[];
  readonly onSaved: () => void;
}

// Ручной ввод: цифры из панели Дзена на дату.
function ManualEntry({ publications, onSaved }: ManualEntryProps) {
  const [articleId, setArticleId] = useState('');
  const [capturedOn, setCapturedOn] = useState(new Date().toISOString().slice(0, 10));
  const [views, setViews] = useState('0');
  const [reads, setReads] = useState('0');
  const [avgReadSeconds, setAvgReadSeconds] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(undefined);
    setWarnings([]);
    try {
      const response = await createMetric({
        articleId,
        capturedOn,
        views: Number(views),
        reads: Number(reads),
        avgReadSeconds: avgReadSeconds.trim().length === 0 ? null : Number(avgReadSeconds),
      });
      setWarnings(response.warnings);
      onSaved();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="manual-title" className={PANEL_CLASS}>
      <h2 id="manual-title" className="font-display text-lg font-bold">
        Ручной ввод
      </h2>
      <p className="mt-2 text-sm text-on-surface-variant">
        Числа из панели Дзена на дату. Ввод повторяет снимок за эту дату.
      </p>
      <div className="mt-3 flex flex-col gap-3">
        <div className={LABEL_CLASS}>
          <label htmlFor="metric-article">Материал</label>
          <select
            id="metric-article"
            className={INPUT_CLASS}
            value={articleId}
            onChange={(event) => setArticleId(event.target.value)}
          >
            <option value="">Выберите материал</option>
            {publications.map((item) => (
              <option key={item.articleId} value={item.articleId}>
                {item.topic}
              </option>
            ))}
          </select>
        </div>
        <div className={LABEL_CLASS}>
          <label htmlFor="metric-date">Дата снимка</label>
          <input
            id="metric-date"
            type="date"
            className={INPUT_CLASS}
            value={capturedOn}
            onChange={(event) => setCapturedOn(event.target.value)}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className={LABEL_CLASS}>
            <label htmlFor="metric-views">Просмотры</label>
            <input
              id="metric-views"
              type="number"
              min={0}
              className={INPUT_CLASS}
              value={views}
              onChange={(event) => setViews(event.target.value)}
            />
          </div>
          <div className={LABEL_CLASS}>
            <label htmlFor="metric-reads">Прочтения</label>
            <input
              id="metric-reads"
              type="number"
              min={0}
              className={INPUT_CLASS}
              value={reads}
              onChange={(event) => setReads(event.target.value)}
            />
          </div>
          <div className={LABEL_CLASS}>
            <label htmlFor="metric-time">Время чтения, с</label>
            <input
              id="metric-time"
              type="number"
              min={0}
              className={INPUT_CLASS}
              value={avgReadSeconds}
              onChange={(event) => setAvgReadSeconds(event.target.value)}
            />
          </div>
        </div>
        {error !== undefined ? <Notice tone="error">{error}</Notice> : null}
        {warnings.length > 0 ? (
          <Notice>
            <ul className="flex flex-col gap-1">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </Notice>
        ) : null}
        <div>
          <button
            type="button"
            className={BUTTON_PRIMARY}
            disabled={busy || articleId.length === 0}
            onClick={() => void save()}
          >
            {busy ? 'Сохраняем…' : 'Внести метрики'}
          </button>
        </div>
      </div>
    </section>
  );
}

// Импорт CSV: ссылка на статью в Дзене, дата, просмотры, прочтения, время чтения.
function CsvImport({ onImported }: { readonly onImported: () => void }) {
  const [csv, setCsv] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<string | undefined>(undefined);
  const [warnings, setWarnings] = useState<{ readonly line: number; readonly reason: string }[]>(
    [],
  );
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    setWarnings([]);
    try {
      const response = await importMetrics(csv);
      setResult(
        `Импортировано: ${response.imported}, обновлено: ${response.updated}, пропущено: ${response.skipped.length}`,
      );
      setWarnings(response.warnings);
      setCsv('');
      onImported();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="import-title" className={PANEL_CLASS}>
      <h2 id="import-title" className="font-display text-lg font-bold">
        Импорт CSV
      </h2>
      <p className="mt-2 text-sm text-on-surface-variant">
        Колонки: <code>url</code>, <code>captured_on</code>, <code>views</code>, <code>reads</code>{' '}
        и необязательная <code>avg_read_seconds</code>. Ссылка сопоставляется с публикацией в
        системе.
      </p>
      <div className="mt-3 flex flex-col gap-3">
        <div className={LABEL_CLASS}>
          <label htmlFor="metric-csv">Файл CSV</label>
          <input
            id="metric-csv"
            type="file"
            accept=".csv,text/csv"
            className={INPUT_CLASS}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) {
                return;
              }
              void file.text().then((text) => setCsv(text));
            }}
          />
        </div>
        <div className={LABEL_CLASS}>
          <label htmlFor="metric-csv-text">Содержимое файла</label>
          <textarea
            id="metric-csv-text"
            className={INPUT_CLASS}
            rows={5}
            value={csv}
            placeholder="url,captured_on,views,reads"
            onChange={(event) => setCsv(event.target.value)}
          />
        </div>
        {error !== undefined ? <Notice tone="error">{error}</Notice> : null}
        {result !== undefined ? <Notice>{result}</Notice> : null}
        {warnings.length > 0 ? (
          <Notice>
            <ul className="flex flex-col gap-1">
              {warnings.map((warning) => (
                <li key={`${warning.line}-${warning.reason}`}>
                  Строка {warning.line}: {warning.reason}
                </li>
              ))}
            </ul>
          </Notice>
        ) : null}
        <div>
          <button
            type="button"
            className={BUTTON_SECONDARY}
            disabled={busy || csv.trim().length === 0}
            onClick={() => void run()}
          >
            {busy ? 'Импортируем…' : 'Импортировать'}
          </button>
        </div>
      </div>
    </section>
  );
}
