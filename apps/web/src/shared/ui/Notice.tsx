import type { ReactNode } from 'react';

interface NoticeProps {
  readonly tone?: 'neutral' | 'error';
  readonly children: ReactNode;
}

// Ошибки объявляются сразу, нейтральные сообщения — вежливо. Роль status
// остаётся только у ServiceStatus, чтобы не дублировать объявления.
export function Notice({ tone = 'neutral', children }: NoticeProps) {
  const toneClass =
    tone === 'error' ? 'bg-error-container text-on-error-container' : 'text-on-surface-variant';
  return (
    <p
      role={tone === 'error' ? 'alert' : undefined}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      className={`rounded-xl p-4 text-base ${toneClass}`}
    >
      {children}
    </p>
  );
}
