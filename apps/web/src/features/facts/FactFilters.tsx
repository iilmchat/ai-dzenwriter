import {
  FACT_STATUS_LABELS,
  FACT_STATUSES,
  FACT_TYPE_LABELS,
  FACT_TYPES,
  type FactStatus,
  type FactType,
} from '@dzenwriter/shared';
import { capitalize, parseOption } from '../../lib/format';
import { INPUT_CLASS, LABEL_CLASS } from '../../shared/ui/classes';

export interface FactsFilters {
  readonly type: FactType | '';
  readonly status: FactStatus | '';
  readonly q: string;
}

export const EMPTY_FACTS_FILTERS: FactsFilters = { type: '', status: '', q: '' };

interface FactFiltersProps {
  readonly filters: FactsFilters;
  readonly onChange: (next: FactsFilters) => void;
}

export function FactFilters({ filters, onChange }: FactFiltersProps) {
  return (
    <div role="group" aria-label="Фильтры фактов" className="flex flex-wrap items-end gap-4">
      <label className={`${LABEL_CLASS} min-w-48`}>
        Тип
        <select
          className={INPUT_CLASS}
          value={filters.type}
          onChange={(event) =>
            onChange({ ...filters, type: parseOption(FACT_TYPES, event.target.value) })
          }
        >
          <option value="">Все типы</option>
          {FACT_TYPES.map((type) => (
            <option key={type} value={type}>
              {capitalize(FACT_TYPE_LABELS[type])}
            </option>
          ))}
        </select>
      </label>
      <label className={`${LABEL_CLASS} min-w-44`}>
        Статус
        <select
          className={INPUT_CLASS}
          value={filters.status}
          onChange={(event) =>
            onChange({ ...filters, status: parseOption(FACT_STATUSES, event.target.value) })
          }
        >
          <option value="">Все статусы</option>
          {FACT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {FACT_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </label>
      <label className={`${LABEL_CLASS} min-w-64 flex-1`}>
        Поиск по тексту
        <input
          type="search"
          className={INPUT_CLASS}
          value={filters.q}
          onChange={(event) => onChange({ ...filters, q: event.target.value })}
        />
      </label>
    </div>
  );
}
