import { useEffect } from 'react';
import { useNavigate } from 'react-router';

export const HOTKEYS: readonly { readonly keys: string; readonly label: string }[] = [
  { keys: 'Alt+B', label: 'Доска материалов' },
  { keys: 'Alt+C', label: 'Календарь' },
  { keys: 'Alt+M', label: 'Метрики' },
  { keys: 'Alt+T', label: 'Мои задачи' },
  { keys: '?', label: 'Справка по горячим клавишам' },
];

export interface GlobalHotkeysOptions {
  readonly onHelp: () => void;
}

// Глобальные переходы по Alt+буква и справка по «?».
export function useGlobalHotkeys({ onHelp }: GlobalHotkeysOptions): void {
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (
        target !== null &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }

      if (event.altKey && !event.ctrlKey && !event.metaKey) {
        const key = event.key.toLowerCase();
        const routes: Record<string, string> = {
          b: '/',
          c: '/calendar',
          m: '/metrics',
          t: '/tasks',
        };
        const route = routes[key];
        if (route !== undefined) {
          event.preventDefault();
          navigate(route);
        }
        return;
      }

      if (event.key === '?' || (event.shiftKey && event.key === '/')) {
        event.preventDefault();
        onHelp();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate, onHelp]);
}
