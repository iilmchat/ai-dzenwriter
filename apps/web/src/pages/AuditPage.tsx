import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_LABELS,
  AUDIT_ENTITIES,
  AUDIT_ENTITY_LABELS,
  type AuditEntry,
  type AuditListResponse,
  type AuditQuery,
  type UserItem,
} from '@dzenwriter/shared';
import { useEffect, useState } from 'react';
import { fetchAudit } from '../api/audit';
import { fetchUsers } from '../api/users';
import { errorMessage } from '../api/client';
import { endOfDayIso, formatDateTime, startOfDayIso, truncate } from '../lib/format';
import { BUTTON_SECONDARY, INPUT_CLASS, LABEL_CLASS, PANEL_CLASS } from '../shared/ui/classes';
import { Notice } from '../shared/ui/Notice';

const SEARCH_DELAY_MS = 250;
// Метка повторяет список метрик: страницы журнала разворачиваются фильтрами.
const PAGE_LIMIT = 500;

interface AuditFilters {
  readonly actorId: string;
  readonly action: string;
  readonly entityType: string;
  readonly from: string;
  readonly to: string;
}

const EMPTY_FILTERS: AuditFilters = {
  actorId: '',
  action: '',
  entityType: '',
  from: '',
  to: '',
};

type AuditPhase =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; items: readonly AuditEntry[]; truncated: boolean };

function toQuery(filters: AuditFilters): AuditQuery {
  return {
    actorId: filters.actorId || undefined,
    action: filters.action || undefined,
    entityType: filters.entityType || undefined,
    from: filters.from ? startOfDayIso(filters.from) : undefined,
    to: filters.to ? endOfDayIso(filters.to) : undefined,
  };
}

function auditActionLabel(action: string): string {
  return action in AUDIT_ACTION_LABELS
    ? AUDIT_ACTION_LABELS[action as keyof typeof AUDIT_ACTION_LABELS]
    : action;
}

function formatPayload(payload: Record<string, unknown>): string {
  const parts = Object.entries(payload).map(([key, value]) => {
    const text =
      value === null || value === undefined
        ? '—'
        : typeof value === 'string'
          ? value
          : JSON.stringify(value);
    return `${key}: ${text}`;
  });
  const line = parts.join('; ');
  return line.length > 0 ? truncate(line, 160) : '—';
}

// Журнал аудита для администратора: кто, что и когда изменил в системе.
export function AuditPage() {
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_FILTERS);
  const [users, setUsers] = useState<readonly UserItem[]>([]);
  const [entries, setEntries] = useState<AuditPhase>({ phase: 'loading' });
  const filterKey = JSON.stringify(filters);

  useEffect(() => {
    let active = true;
    // Короткая пауза: фильтры прыгают по нескольким полям подряд.
    const timer = window.setTimeout(() => {
      fetchAudit(toQuery(JSON.parse(filterKey) as AuditFilters)).then(
        (response: AuditListResponse) => {
          if (active) {
            setEntries({ phase: 'ready', items: response.items, truncated: response.truncated });
          }
        },
        (cause: unknown) => {
          if (active) {
            setEntries({ phase: 'error', message: errorMessage(cause) });
          }
        },
      );
    }, SEARCH_DELAY_MS);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [filterKey]);

  useEffect(() => {
    fetchUsers().then(
      (response) => setUsers(response.items),
      // Список сотрудников только усложняет фильтр «кто»: неудача не мешает просмотр журнала.
      () => setUsers([]),
    );
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-bold">Журнал аудита</h1>
        <p className="max-w-3xl text-on-surface-variant">
          Кто, что и когда изменил в системе. Записи не удаляются и не редактируются, детали
          действия — идентификаторы и значения ролей без логинов и имён.
        </p>
      </header>

      <section aria-label="Фильтры журнала" className={PANEL_CLASS}>
        <div className="grid gap-3 lg:grid-cols-5">
          <div className={LABEL_CLASS}>
            <label htmlFor="audit-actor">Кто</label>
            <select
              id="audit-actor"
              className={INPUT_CLASS}
              value={filters.actorId}
              onChange={(event) =>
                setFilters((current) => ({ ...current, actorId: event.target.value }))
              }
            >
              <option value="">Все сотрудники</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name ?? user.login}
                  {user.disabled ? ' (отключён)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className={LABEL_CLASS}>
            <label htmlFor="audit-action">Действие</label>
            <select
              id="audit-action"
              className={INPUT_CLASS}
              value={filters.action}
              onChange={(event) =>
                setFilters((current) => ({ ...current, action: event.target.value }))
              }
            >
              <option value="">Все действия</option>
              {AUDIT_ACTIONS.map((action) => (
                <option key={action} value={action}>
                  {AUDIT_ACTION_LABELS[action]}
                </option>
              ))}
            </select>
          </div>
          <div className={LABEL_CLASS}>
            <label htmlFor="audit-entity">Сущность</label>
            <select
              id="audit-entity"
              className={INPUT_CLASS}
              value={filters.entityType}
              onChange={(event) =>
                setFilters((current) => ({ ...current, entityType: event.target.value }))
              }
            >
              <option value="">Все сущности</option>
              {AUDIT_ENTITIES.map((entityType) => (
                <option key={entityType} value={entityType}>
                  {AUDIT_ENTITY_LABELS[entityType]}
                </option>
              ))}
            </select>
          </div>
          <div className={LABEL_CLASS}>
            <label htmlFor="audit-from">С даты</label>
            <input
              id="audit-from"
              type="date"
              className={INPUT_CLASS}
              value={filters.from}
              onChange={(event) =>
                setFilters((current) => ({ ...current, from: event.target.value }))
              }
            />
          </div>
          <div className={LABEL_CLASS}>
            <label htmlFor="audit-to">По дату</label>
            <input
              id="audit-to"
              type="date"
              className={INPUT_CLASS}
              value={filters.to}
              onChange={(event) =>
                setFilters((current) => ({ ...current, to: event.target.value }))
              }
            />
          </div>
        </div>
        <div className="mt-3">
          <button
            type="button"
            className={BUTTON_SECONDARY}
            onClick={() => setFilters(EMPTY_FILTERS)}
          >
            Сбросить
          </button>
        </div>
      </section>

      {entries.phase === 'error' ? <Notice tone="error">{entries.message}</Notice> : null}

      {entries.phase === 'loading' ? <Notice>Загружаем журнал…</Notice> : null}

      {entries.phase === 'ready' ? (
        <section aria-labelledby="audit-table-title" className={PANEL_CLASS}>
          <h2 id="audit-table-title" className="font-display text-lg font-bold">
            Записи ({entries.items.length})
          </h2>
          {entries.truncated ? (
            <p className="mt-2 text-sm text-on-surface-variant">
              {`Показаны последние ${PAGE_LIMIT} записей. Уточните фильтры, чтобы увидеть более старые.`}
            </p>
          ) : null}
          {entries.items.length === 0 ? (
            <p className="mt-3 text-sm text-on-surface-variant">
              Записей нет. Смените фильтры или период.
            </p>
          ) : (
            <AuditTable items={entries.items} />
          )}
        </section>
      ) : null}
    </div>
  );
}

function AuditTable({ items }: { readonly items: readonly AuditEntry[] }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-outline-variant">
            <th className="py-2 pr-3 font-medium">Когда</th>
            <th className="py-2 pr-3 font-medium">Кто</th>
            <th className="py-2 pr-3 font-medium">Действие</th>
            <th className="py-2 pr-3 font-medium">Сущность</th>
            <th className="py-2 font-medium">Детали</th>
          </tr>
        </thead>
        <tbody>
          {items.map((entry) => (
            <tr
              key={entry.id}
              className="border-b border-outline-variant align-top last:border-b-0"
            >
              <td className="py-2 pr-3 whitespace-nowrap">
                <FormatDate value={entry.createdAt} />
              </td>
              <td className="py-2 pr-3">
                {entry.actorName ?? entry.actorLogin ?? '—'}
                {entry.actorLogin !== null ? (
                  <span className="block text-xs text-on-surface-variant">{entry.actorLogin}</span>
                ) : null}
              </td>
              <td className="py-2 pr-3" title={entry.action}>
                {auditActionLabel(entry.action)}
              </td>
              <td className="py-2 pr-3">
                <span className="text-on-surface-variant">
                  {AUDIT_ENTITY_LABELS[entry.entityType as keyof typeof AUDIT_ENTITY_LABELS] ??
                    entry.entityType}
                </span>
                <span className="block text-xs text-on-surface-variant">
                  {truncate(entry.entityId, 12)}
                </span>
              </td>
              <td className="py-2">
                <code className="text-xs text-on-surface-variant">
                  {formatPayload(entry.payload)}
                </code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FormatDate({ value }: { readonly value: string }) {
  return <span className="block">{formatDateTime(value)}</span>;
}
