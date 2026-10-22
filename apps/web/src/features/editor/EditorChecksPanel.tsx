import { CHECK_LABELS, type AllCheckId, type VersionCheck } from '@dzenwriter/shared';
import { PANEL_CLASS } from '../../shared/ui/classes';

export interface EditorChecksPanelProps {
  readonly checks: readonly VersionCheck[];
  // Клик по проверке переводит курсор в исходник и подсвечивает фрагмент.
  readonly onFocus: (check: VersionCheck) => void;
}

const GROUPS: readonly { readonly severity: VersionCheck['severity']; readonly title: string }[] = [
  { severity: 'block', title: 'Блокирует' },
  { severity: 'warn', title: 'Предупреждения' },
  { severity: 'info', title: 'Информация' },
];

// Панель проверок редактора: проверки сгруппированы по уровню, клик ведёт в текст.
export function EditorChecksPanel({ checks, onFocus }: EditorChecksPanelProps) {
  const blocking = checks.filter(
    (check) => check.severity === 'block' && check.decision !== 'confirmed',
  ).length;

  return (
    <aside className={PANEL_CLASS} aria-label="Проверки">
      <h2 className="font-display text-lg font-bold">Проверки</h2>
      {checks.length === 0 ? (
        <p className="mt-3 text-sm text-on-surface-variant">
          Нарушений не найдено. Проверки считаются при сохранении версии.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm font-medium">
            {blocking === 0
              ? 'Блокирующих проверок нет'
              : `Блокирующих проверок: ${blocking}. На ревью не отправить`}
          </p>
          {GROUPS.map((group) => {
            const items = checks.filter((check) => check.severity === group.severity);
            if (items.length === 0) {
              return null;
            }
            return (
              <div key={group.severity} className="mt-4">
                <p className="text-xs font-semibold text-on-surface-variant">{group.title}</p>
                <ul className="mt-2 flex flex-col gap-2">
                  {items.map((check, index) => (
                    <li key={`${check.id}-${check.start ?? 'нет позиции'}-${index}`}>
                      <button
                        type="button"
                        className={`w-full rounded-xl p-3 text-left text-sm ${
                          check.severity === 'block'
                            ? 'bg-error-container text-on-error-container'
                            : check.severity === 'warn'
                              ? 'bg-surface-container-high text-on-surface'
                              : 'bg-surface-container text-on-surface-variant'
                        }`}
                        onClick={() => onFocus(check)}
                      >
                        <span className="block font-medium">
                          {labelOf(check)}
                          {check.decision === 'confirmed' ? ' · подтверждено' : ''}
                        </span>
                        <span className="block">{check.message}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </>
      )}
    </aside>
  );
}

// У проверки есть идентификатор из списка движка, но в базе может оказаться
// проверка из будущей версии правил: тогда показываем её идентификатор.
function labelOf(check: VersionCheck): string {
  return CHECK_LABELS[check.id as AllCheckId] ?? check.id;
}
