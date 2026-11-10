import { useEffect, useState } from 'react';
import { FOCUS_RING } from '../shared/ui/classes';

const STORAGE_KEY = 'dzenwriter:theme';
type Theme = 'light' | 'dark';

function readStoredTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  if (typeof window.matchMedia !== 'function') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.toggle('dark', theme === 'dark');
}

// Тема хранится в localStorage; без сохранённого значения берётся системная.
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme() ?? systemTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Приватный режим: тема переключится, но не сохранится.
    }
  }

  return (
    <button
      type="button"
      aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
      aria-pressed={theme === 'dark'}
      title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
      className={`inline-flex h-10 w-10 items-center justify-center rounded-full border border-outline-variant bg-surface text-on-surface ${FOCUS_RING}`}
      onClick={toggle}
    >
      {theme === 'dark' ? (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width={20}
          height={20}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width={20}
          height={20}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
        >
          <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />
        </svg>
      )}
    </button>
  );
}
