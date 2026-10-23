import {
  VERSION_ORIGIN_LABELS,
  diffParagraphs,
  type DiffPair,
  type VersionDetail,
  type VersionSummary,
} from '@dzenwriter/shared';
import { useState } from 'react';
import { fetchVersion } from '../../api/versions';
import { formatDateTime } from '../../lib/format';
import { BUTTON_SECONDARY, PANEL_CLASS } from '../../shared/ui/classes';

export interface VersionHistoryProps {
  readonly articleId: string;
  readonly versions: readonly VersionSummary[];
  readonly currentNumber: number | null;
  readonly onOpen: (number: number) => void;
  readonly onRollback: (number: number) => void;
}

// История версий и сравнение: открываются боковой панелью, сравнение идёт по абзацам.
export function VersionHistory({
  articleId,
  versions,
  currentNumber,
  onOpen,
  onRollback,
}: VersionHistoryProps) {
  const [compareWith, setCompareWith] = useState<number | null>(null);
  const [left, setLeft] = useState<VersionDetail | null>(null);
  const [right, setRight] = useState<VersionDetail | null>(null);

  // Сравнение выбранной версии с текущей: слева выбранная, справа текущая.
  async function compare(number: number) {
    if (currentNumber === null || number === currentNumber) {
      return;
    }
    setCompareWith(number);
    setLeft(null);
    setRight(null);
    const [older, newer] = await Promise.all([
      loadVersion(articleId, number),
      loadVersion(articleId, currentNumber),
    ]);
    setLeft(older);
    setRight(newer);
  }

  if (compareWith !== null && left !== null && right !== null) {
    const pairs = diffParagraphs(left.articleMarkdown, right.articleMarkdown);
    return (
      <div className={PANEL_CLASS}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-bold">
            Сравнение: версия {left.number} и {right.number}
          </h2>
          <button
            type="button"
            className={BUTTON_SECONDARY}
            onClick={() => {
              setCompareWith(null);
              setLeft(null);
              setRight(null);
            }}
          >
            Закрыть
          </button>
        </div>
        <VersionDiff pairs={pairs} />
      </div>
    );
  }

  return (
    <div className={PANEL_CLASS}>
      <h2 className="font-display text-lg font-bold">История версий</h2>
      {versions.length === 0 ? (
        <p className="mt-3 text-sm text-on-surface-variant">Версий пока нет.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {versions.map((version) => (
            <li
              key={version.number}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-outline-variant p-3"
            >
              <span>
                Версия {version.number}: {VERSION_ORIGIN_LABELS[version.origin] ?? version.origin}
                {version.number === currentNumber ? ' · текущая' : ''}
                <span className="block text-on-surface-variant">
                  {formatDateTime(version.createdAt)} · {version.createdBy} · блокирующих:{' '}
                  {version.blockingChecks}
                </span>
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  className={BUTTON_SECONDARY}
                  disabled={version.number === currentNumber}
                  onClick={() => void compare(version.number)}
                >
                  Сравнить
                </button>
                <button
                  type="button"
                  className={BUTTON_SECONDARY}
                  onClick={() => onOpen(version.number)}
                >
                  Открыть
                </button>
                {version.number !== currentNumber ? (
                  <button
                    type="button"
                    className={BUTTON_SECONDARY}
                    onClick={() => onRollback(version.number)}
                  >
                    Откатить
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Сравнение по абзацам: добавленные, удалённые и изменённые.
function VersionDiff({ pairs }: { readonly pairs: readonly DiffPair[] }) {
  if (pairs.length === 0) {
    return <p className="mt-3 text-sm text-on-surface-variant">Различий нет.</p>;
  }
  return (
    <ul className="mt-3 flex flex-col gap-2 text-sm">
      {pairs.map((pair, index) => (
        <li key={index} className="rounded-xl border border-outline-variant p-3">
          <span className="mb-1 block text-xs font-semibold text-on-surface-variant">
            {DIFF_LABELS[pair.kind]}
          </span>
          {pair.left !== null ? (
            <p className={pair.kind === 'same' ? '' : 'dz-diff dz-diff--old'}>{pair.left}</p>
          ) : null}
          {pair.right !== null ? (
            <p className={pair.kind === 'same' ? '' : 'dz-diff dz-diff--new'}>{pair.right}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

const DIFF_LABELS: Record<DiffPair['kind'], string> = {
  same: 'Без изменений',
  added: 'Добавлено',
  removed: 'Удалено',
  changed: 'Изменено',
};

// Загрузка версии для сравнения: ошибка не должна ронять страницу.
async function loadVersion(articleId: string, number: number): Promise<VersionDetail | null> {
  try {
    return await fetchVersion(articleId, number);
  } catch {
    return null;
  }
}
