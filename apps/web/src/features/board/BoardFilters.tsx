import type { StyleCard } from '@dzenwriter/shared';
import type { BoardFilters as Filters } from '../../api/articles';
import { INPUT_CLASS, LABEL_CLASS } from '../../shared/ui/classes';

interface BoardFiltersProps {
  readonly filters: Filters;
  readonly styles: readonly StyleCard[];
  readonly onChange: (next: Filters) => void;
}

export function BoardFilters({ filters, styles, onChange }: BoardFiltersProps) {
  return (
    <div role="group" aria-label="Фильтры доски" className="flex flex-wrap items-end gap-4">
      <label className={`${LABEL_CLASS} min-w-48`}>
        Стиль
        <select
          className={INPUT_CLASS}
          value={filters.styleId}
          onChange={(event) => onChange({ ...filters, styleId: event.target.value })}
        >
          <option value="">Все стили</option>
          {styles.map((style) => (
            <option key={style.id} value={style.id}>
              {style.name}
            </option>
          ))}
        </select>
      </label>
      <label className={`${LABEL_CLASS} min-w-44`}>
        Автор
        <select
          className={INPUT_CLASS}
          value={filters.mine ? 'mine' : 'all'}
          onChange={(event) => onChange({ ...filters, mine: event.target.value === 'mine' })}
        >
          <option value="all">Все авторы</option>
          <option value="mine">Мои материалы</option>
        </select>
      </label>
      <label className={LABEL_CLASS}>
        Плановая дата с
        <input
          type="date"
          className={INPUT_CLASS}
          value={filters.plannedFrom}
          onChange={(event) => onChange({ ...filters, plannedFrom: event.target.value })}
        />
      </label>
      <label className={LABEL_CLASS}>
        по
        <input
          type="date"
          className={INPUT_CLASS}
          value={filters.plannedTo}
          onChange={(event) => onChange({ ...filters, plannedTo: event.target.value })}
        />
      </label>
      <label className="flex items-center gap-2 pb-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={filters.includeArchived}
          onChange={(event) => onChange({ ...filters, includeArchived: event.target.checked })}
        />
        Показать архив
      </label>
    </div>
  );
}
