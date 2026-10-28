import type { MetricSnapshot, PublicationItem } from '@dzenwriter/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { errorMessage } from '../api/client';
import { createMetric, fetchMetrics, importMetrics } from '../api/metrics';
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

// Метрики публикаций: ручной ввод, импорт CSV и сравнение материалов.
export function MetricsPage() {
  const [snapshots, setSnapshots] = useState<MetricSnapshot[]>([]);
  const [publications, setPublications] = useState<PublicationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);

  const load = useCallback((silent = false) => {
    // Перед первым прогоном показываем загрузку; повторные — тихие,
    // чтобы не стирать форму и итог импорта на время обновления данных.
    if (!silent) {
      setLoading(true);
    }
    Promise.all([fetchMetrics(), fetchPublications()]).then(
      ([metrics, published]) => {
        setSnapshots(metrics.items);
        setPublications(published.items);
        setLoading(false);
      },
      (cause: unknown) => {
        setError(errorMessage(cause));
        setLoading(false);
      },
    );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const comparison = useMemo(() => compareByArticle(snapshots), [snapshots]);

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
        <Notice>Загружаем метрики…</Notice>
      ) : (
        <>
          <ComparisonTable comparison={comparison} />

          <div className="grid gap-4 lg:grid-cols-2">
            <ManualEntry publications={publications} onSaved={() => load(true)} />
            <CsvImport onImported={() => load(true)} />
          </div>
        </>
      )}
    </div>
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
