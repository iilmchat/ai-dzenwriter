import type { ReactNode } from 'react';

interface NoticeProps {
  readonly tone?: 'neutral' | 'error';
  readonly children: ReactNode;
}

// Сообщение без роли status: на странице может быть только один статус сервиса.
export function Notice({ tone = 'neutral', children }: NoticeProps) {
  const toneClass =
    tone === 'error' ? 'bg-error-container text-on-error-container' : 'text-on-surface-variant';
  return <p className={`rounded-xl p-4 text-base ${toneClass}`}>{children}</p>;
}
