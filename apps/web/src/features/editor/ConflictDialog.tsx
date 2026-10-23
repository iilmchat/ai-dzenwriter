import { diffParagraphs, type VersionDetail } from '@dzenwriter/shared';
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from '../../shared/ui/classes';
import { VersionDiff } from './VersionHistory';

interface ConflictDialogProps {
  readonly localMarkdown: string;
  readonly latestVersion: VersionDetail | null;
  readonly showDiff: boolean;
  readonly onCompare: () => void;
  readonly onReload: () => void;
}

// Конфликт версий: локальный черновик не перезаписывает сервер молча.
export function ConflictDialog({
  localMarkdown,
  latestVersion,
  showDiff,
  onCompare,
  onReload,
}: ConflictDialogProps) {
  const pairs =
    showDiff && latestVersion ? diffParagraphs(localMarkdown, latestVersion.articleMarkdown) : [];
  const onlyMetadata =
    showDiff &&
    latestVersion !== null &&
    pairs.length > 0 &&
    pairs.every((pair) => pair.kind === 'same');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-2xl border border-outline-variant bg-surface p-6 shadow-xl">
        <h2 id="conflict-title" className="font-display text-xl font-bold">
          Материал изменили
        </h2>
        <p className="mt-2 text-sm text-on-surface-variant">
          Пока вы редактировали, на сервере появилась{' '}
          {latestVersion ? `версия ${latestVersion.number}` : 'новая версия'}. Сохранение не
          перезаписало её. Сравните локальный черновик с сервером или загрузите последнюю версию.
        </p>

        {showDiff ? (
          <div className="mt-4">
            <p className="text-xs text-on-surface-variant">
              Сравнение по тексту статьи; метаданные и заголовок в diff не входят.
            </p>
            {latestVersion === null ? (
              <p className="mt-3 text-sm text-on-surface-variant">
                На сервере ещё нет версии текста.
              </p>
            ) : onlyMetadata ? (
              <p className="mt-3 text-sm text-on-surface-variant">
                Текст совпадает; отличаются заголовок или метаданные.
              </p>
            ) : (
              <VersionDiff pairs={pairs} />
            )}
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            className={BUTTON_SECONDARY}
            disabled={latestVersion === null}
            onClick={onCompare}
          >
            {showDiff ? 'Скрыть сравнение' : 'Сравнить'}
          </button>
          <button type="button" className={BUTTON_PRIMARY} onClick={onReload}>
            Перезагрузить
          </button>
        </div>
      </div>
    </div>
  );
}
