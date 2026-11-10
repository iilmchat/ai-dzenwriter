import { useEffect } from 'react';
import { BUTTON_SECONDARY, PANEL_CLASS } from '../shared/ui/classes';
import { HOTKEYS } from './useGlobalHotkeys';

export interface HotkeysHelpProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

// Справка по горячим клавишам: открывается по «?».
export function HotkeysHelp({ open, onClose }: HotkeysHelpProps) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-24">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Горячие клавиши"
        className={`${PANEL_CLASS} w-full max-w-md`}
      >
        <h2 className="font-display text-lg font-bold">Горячие клавиши</h2>
        <ul className="mt-4 flex flex-col gap-2">
          {HOTKEYS.map((item) => (
            <li key={item.keys} className="flex items-center justify-between gap-3 text-sm">
              <span>{item.label}</span>
              <kbd className="rounded-md border border-outline-variant bg-surface px-2 py-0.5 font-mono text-xs">
                {item.keys}
              </kbd>
            </li>
          ))}
        </ul>
        <div className="mt-4">
          <button type="button" className={BUTTON_SECONDARY} autoFocus onClick={onClose}>
            Закрыть
          </button>
        </div>
        <p className="mt-3 text-xs text-on-surface-variant">
          Сочетания не срабатывают, когда курсор в поле ввода.
        </p>
      </div>
    </div>
  );
}
