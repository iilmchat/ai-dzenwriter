import type { CSSProperties } from 'react';

export interface SkeletonProps {
  readonly width?: string | number;
  readonly height?: string | number;
  readonly className?: string;
}

// Пульсирующая заглушка загрузки: для скринридеров скрыта, роль несёт контейнер.
export function Skeleton({ width = '100%', height = '1rem', className = '' }: SkeletonProps) {
  const style: CSSProperties = { width, height };
  return (
    <div
      aria-hidden="true"
      data-testid="skeleton"
      style={style}
      className={`animate-pulse rounded-lg bg-surface-container-highest motion-reduce:animate-none ${className}`}
    />
  );
}
