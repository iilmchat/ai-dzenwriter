import { REVIEW_RUBRIC_LABELS, type PilotMetricsResponse } from '@dzenwriter/shared';
import { type FormEvent, useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { errorMessage } from '../api/client';
import { fetchPilotMetrics, type PilotFilters } from '../api/pilot';
import { BUTTON_PRIMARY, INPUT_CLASS, LABEL_CLASS, PANEL_CLASS } from '../shared/ui/classes';
import { Notice } from '../shared/ui/Notice';

const EMPTY_FILTERS: PilotFilters = { from: '', to: '' };

// Показатели пилота: агрегаты по материалам и генерациям. Экран доступен администратору
// и загружается лениво: recharts не попадает в стартовый чанк приложения.
export function AdminPilotPage() {
  const [filters, setFilters] = useState<PilotFilters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<PilotFilters>(EMPTY_FILTERS);
  const [metrics, setMetrics] = useState<PilotMetricsResponse | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    fetchPilotMetrics(appliedFilters).then(
      (response) => {
        if (active) {
          setMetrics(response);
          setLoading(false);
        }
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
  }, [appliedFilters]);

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAppliedFilters({ ...filters });
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-bold">Показатели пилота</h1>
        <p className="text-on-surface-variant">
          Агрегаты по материалам и генерациям за период. Даты считаются по Москве, границы
          включаются.
        </p>
      </header>

      <form onSubmit={apply} className={`${PANEL_CLASS} flex flex-wrap items-end gap-4`}>
        <label className={LABEL_CLASS}>
          С даты
          <input
            type="date"
            className={INPUT_CLASS}
            value={filters.from}
            onChange={(event) => setFilters({ ...filters, from: event.target.value })}
          />
        </label>
        <label className={LABEL_CLASS}>
          По дату
          <input
            type="date"
            className={INPUT_CLASS}
            value={filters.to}
            onChange={(event) => setFilters({ ...filters, to: event.target.value })}
          />
        </label>
        <button type="submit" className={BUTTON_PRIMARY}>
          Показать
        </button>
      </form>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {loading ? <Notice>Считаем показатели…</Notice> : null}

      {!loading && metrics ? <PilotReport metrics={metrics} /> : null}
    </div>
  );
}

function PilotReport({ metrics }: { readonly metrics: PilotMetricsResponse }) {
  const articles = metrics.articles;
  const generation = metrics.generation;

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="pilot-articles-title" className="flex flex-col gap-4">
        <div>
          <h2 id="pilot-articles-title" className="font-display text-xl font-bold">
            Материалы
          </h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            Всего: {articles.total}. Утверждено: {articles.approved}. Прошли ревью:{' '}
            {articles.reviewed}.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            label="Время до утверждения"
            value={formatHours(articles.approvalMedianHours)}
            hint="медиана от создания до первого утверждения"
          />
          <MetricCard
            label="Без возврата на доработку"
            value={formatShare(articles.approvedWithoutReturnShare)}
            hint={`${articles.approvedWithoutReturn} из ${articles.approved} утверждённых`}
          />
          <MetricCard
            label="Гейт поймал до ревью"
            value={formatShare(articles.gateCaughtBeforeReviewShare)}
            hint={`${articles.gateCaught} из ${articles.reviewed} ${pluralMaterials(articles.reviewed)} с ревью`}
          />
          <MetricCard
            label="Правки после генерации"
            value={formatShare(articles.textChangedAfterGenerationShare)}
            hint={`${articles.textChangedAfterGeneration} из ${articles.withGeneratedVersion} ${pluralGenerated(articles.withGeneratedVersion)}`}
          />
          <MetricCard
            label="Оценка редактора"
            value={formatRating(articles.averageRating)}
            hint={`${articles.ratedArticles} ${pluralEvaluations(articles.ratedArticles)} по шкале 1–5`}
          />
          <MetricCard
            label="Материалов в периоде"
            value={String(articles.total)}
            hint={`${articles.approved} утверждено`}
          />
        </div>
        {articles.rubricRatedArticles > 0 ? (
          <p className="text-sm text-on-surface-variant">
            Рубрика редактора ({articles.rubricRatedArticles}{' '}
            {pluralEvaluations(articles.rubricRatedArticles)}):{' '}
            {formatRubricAverages(articles.averageRubric)}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="pilot-generation-title" className="flex flex-col gap-4">
        <div>
          <h2 id="pilot-generation-title" className="font-display text-xl font-bold">
            Генерация
          </h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            Запуски модели и стоимость. Цифры помогают понять, где не хватает фактов и бюджета.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            label="Запусков"
            value={String(generation.runs)}
            hint={`успешно: ${generation.succeeded}, needs_input: ${generation.needsInput}, ошибок: ${generation.failed}`}
          />
          <MetricCard
            label="Доля needs_input"
            value={formatShare(generation.needsInputShare)}
            hint="запусков, где модели не хватило фактов"
          />
          <MetricCard
            label="Доля ошибок"
            value={formatShare(generation.failureShare)}
            hint="неуспешных запусков"
          />
          <MetricCard
            label="Стоимость генерации"
            value={formatMoney(generation.costUsd)}
            hint="суммарно за период"
          />
          <MetricCard
            label="Стоимость на материал"
            value={formatMoney(generation.costPerArticle)}
            hint="по материалам, где были запуски"
          />
          <MetricCard
            label="Отменено"
            value={String(generation.cancelled)}
            hint="запусков отменено автором"
          />
        </div>

        <section aria-labelledby="pilot-questions-title" className={PANEL_CLASS}>
          <h3 id="pilot-questions-title" className="font-display text-base font-bold">
            Причины needs_input
          </h3>
          {generation.questions.length === 0 ? (
            <p className="mt-2 text-sm text-on-surface-variant">
              Запусков needs_input за период не было.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {generation.questions.map((item) => (
                <li
                  key={item.question}
                  className="flex items-start justify-between gap-3 rounded-lg border border-outline-variant px-3 py-2"
                >
                  <span>{item.question}</span>
                  <span className="shrink-0 font-medium">{item.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>

      <section aria-labelledby="pilot-styles-title" className="flex flex-col gap-4">
        <div>
          <h2 id="pilot-styles-title" className="font-display text-xl font-bold">
            Статистика по стилям
          </h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            Запуски по статусам, стоимость и средняя задержка для каждого стиля.
          </p>
        </div>
        {generation.byStyle.length === 0 ? (
          <p className={`${PANEL_CLASS} text-sm text-on-surface-variant`}>
            Нет данных за выбранный период
          </p>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            <div className={`${PANEL_CLASS} min-w-0`}>
              <h3 className="font-display text-base font-bold">Запуски по статусам</h3>
              <div className="mt-3 h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={[...generation.byStyle]}>
                    <CartesianGrid stroke="var(--color-outline-variant)" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="styleName"
                      tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12 }}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12 }}
                    />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Legend />
                    <Bar dataKey="succeeded" name="Успешно" fill="var(--color-primary)" />
                    <Bar dataKey="failed" name="Ошибки" fill="var(--color-error)" />
                    <Bar dataKey="needsInput" name="Needs Input" fill="var(--color-tertiary)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className={`${PANEL_CLASS} min-w-0 overflow-x-auto`}>
              <h3 className="font-display text-base font-bold">Стоимость и задержка</h3>
              <table className="mt-3 w-full min-w-[420px] text-left text-sm">
                <thead className="border-b border-outline-variant text-on-surface-variant">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Стиль</th>
                    <th className="py-2 pr-3 text-right font-medium">Запусков</th>
                    <th className="py-2 pr-3 text-right font-medium">Стоимость</th>
                    <th className="py-2 text-right font-medium">Средняя задержка</th>
                  </tr>
                </thead>
                <tbody>
                  {generation.byStyle.map((item) => (
                    <tr key={item.styleId} className="border-b border-outline-variant/60">
                      <td className="py-2 pr-3">{item.styleName}</td>
                      <td className="py-2 pr-3 text-right">{item.totalRuns}</td>
                      <td className="py-2 pr-3 text-right">{formatMoney(item.totalCostUsd)}</td>
                      <td className="py-2 text-right">{formatLatency(item.avgLatencyMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="pilot-prompts-title" className="flex flex-col gap-4">
        <div>
          <h2 id="pilot-prompts-title" className="font-display text-xl font-bold">
            Статистика по промптам
          </h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            Распределение запусков по версиям промптов и итоги по каждой версии.
          </p>
        </div>
        {generation.byPromptVersion.length === 0 ? (
          <p className={`${PANEL_CLASS} text-sm text-on-surface-variant`}>
            Нет данных за выбранный период
          </p>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            <div className={`${PANEL_CLASS} min-w-0`}>
              <h3 className="font-display text-base font-bold">Распределение запусков</h3>
              <div className="mt-3 h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={generation.byPromptVersion.map((item) => ({
                        ...item,
                        name: shortPromptVersion(item.promptVersion),
                      }))}
                      dataKey="totalRuns"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      label
                    >
                      {generation.byPromptVersion.map((item, index) => (
                        <Cell
                          key={item.promptVersion}
                          fill={PROMPT_COLORS[index % PROMPT_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className={`${PANEL_CLASS} min-w-0 overflow-x-auto`}>
              <h3 className="font-display text-base font-bold">Итоги по версиям</h3>
              <table className="mt-3 w-full min-w-[460px] text-left text-sm">
                <thead className="border-b border-outline-variant text-on-surface-variant">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Версия</th>
                    <th className="py-2 pr-3 text-right font-medium">Запусков</th>
                    <th className="py-2 pr-3 text-right font-medium">Успешно</th>
                    <th className="py-2 pr-3 text-right font-medium">Ошибки</th>
                    <th className="py-2 text-right font-medium">Стоимость</th>
                  </tr>
                </thead>
                <tbody>
                  {generation.byPromptVersion.map((item) => (
                    <tr key={item.promptVersion} className="border-b border-outline-variant/60">
                      <td className="py-2 pr-3 font-mono text-xs">
                        {shortPromptVersion(item.promptVersion)}
                      </td>
                      <td className="py-2 pr-3 text-right">{item.totalRuns}</td>
                      <td className="py-2 pr-3 text-right">{item.succeeded}</td>
                      <td className="py-2 pr-3 text-right">{item.failed}</td>
                      <td className="py-2 text-right">{formatMoney(item.totalCostUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

const PROMPT_COLORS = [
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

function shortPromptVersion(value: string): string {
  return value.length > 18 ? `${value.slice(0, 18)}…` : value;
}

function formatLatency(value: number | null): string {
  return value === null ? '—' : `${numberFormat.format(Math.round(value))} мс`;
}

function MetricCard({
  label,
  value,
  hint,
}: {
  readonly label: string;
  readonly value: string;
  readonly hint: string;
}) {
  return (
    <div className={PANEL_CLASS}>
      <p className="text-sm font-medium text-on-surface-variant">{label}</p>
      <p className="mt-2 font-display text-2xl font-bold">{value}</p>
      <p className="mt-1 text-xs text-on-surface-variant">{hint}</p>
    </div>
  );
}

const pluralRules = new Intl.PluralRules('ru-RU');
const numberFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const ratingFormat = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const moneyFormat = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatHours(value: number | null): string {
  if (value === null) {
    return '—';
  }
  if (value < 48) {
    return `${numberFormat.format(value)} ч`;
  }
  return `${numberFormat.format(value / 24)} дн.`;
}

function formatShare(value: number | null): string {
  return value === null ? '—' : `${numberFormat.format(value * 100)}%`;
}

function pluralMaterials(count: number): string {
  const form = pluralRules.select(count);
  return form === 'one' ? 'материала' : 'материалов';
}

function pluralEvaluations(count: number): string {
  const form = pluralRules.select(count);
  if (form === 'one') {
    return 'оценка';
  }
  if (form === 'few') {
    return 'оценки';
  }
  return 'оценок';
}

function pluralGenerated(count: number): string {
  return pluralRules.select(count) === 'one' ? 'сгенерированного' : 'сгенерированных';
}

function formatRating(value: number | null): string {
  return value === null ? '—' : `${ratingFormat.format(value)} / 5`;
}

// Средние по критериям рубрики: «точность 4.2 / 5 · стиль 3.8 / 5 …».
function formatRubricAverages(rubric: PilotMetricsResponse['articles']['averageRubric']): string {
  const parts = (Object.keys(REVIEW_RUBRIC_LABELS) as Array<keyof typeof rubric>).map((key) => {
    const value = rubric[key];
    return `${REVIEW_RUBRIC_LABELS[key].toLowerCase()} ${value === null ? '—' : `${ratingFormat.format(value)} / 5`}`;
  });
  return parts.join(' · ');
}

function formatMoney(value: number | null): string {
  return value === null ? '—' : moneyFormat.format(value);
}
