import { useEffect, useRef, useState } from 'react';
import { INPUT_CLASS, PANEL_CLASS } from '../../shared/ui/classes';

export interface Command {
  readonly id: string;
  readonly title: string;
  readonly hint?: string;
  readonly run: () => void;
}

export interface CommandPaletteProps {
  readonly open: boolean;
  readonly commands: readonly Command[];
  readonly onClose: () => void;
}

// Палитра команд по Ctrl+K: поиск по названию, стрелки и Enter.
export function CommandPalette({ open, commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      inputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const found = commands.filter((command) =>
    command.title.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-24">
      <div className={`${PANEL_CLASS} w-full max-w-lg`} role="dialog" aria-label="Палитра команд">
        <input
          ref={inputRef}
          className={INPUT_CLASS}
          value={query}
          placeholder="Команда"
          aria-label="Поиск команды"
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((value) => Math.min(value + 1, found.length - 1));
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((value) => Math.max(value - 1, 0));
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              const command = found[active];
              if (command) {
                onClose();
                command.run();
              }
            }
          }}
        />
        {found.length === 0 ? (
          <p className="mt-3 text-sm text-on-surface-variant">Команда не найдена.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-1">
            {found.map((command, index) => (
              <li key={command.id}>
                <button
                  type="button"
                  className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm ${
                    index === active ? 'bg-secondary-container text-on-secondary-container' : ''
                  }`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => {
                    onClose();
                    command.run();
                  }}
                >
                  <span>{command.title}</span>
                  {command.hint !== undefined ? (
                    <span className="text-xs text-on-surface-variant">{command.hint}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
