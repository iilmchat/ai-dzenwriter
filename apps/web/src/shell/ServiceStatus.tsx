import { useEffect, useState } from 'react';
import { fetchReadiness, type ReadinessState } from '../api/readiness';

// Состояние сервиса по /ready. Единственный элемент role="status" на странице.
export function ServiceStatus() {
  const [state, setState] = useState<ReadinessState>({ phase: 'loading' });

  useEffect(() => {
    let active = true;
    fetchReadiness().then((next) => {
      if (active) {
        setState(next);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <p className="text-sm text-on-surface-variant">
      Состояние сервиса:{' '}
      <span role="status" className="font-medium text-on-surface">
        {statusText(state)}
      </span>
    </p>
  );
}

function statusText(state: ReadinessState): string {
  switch (state.phase) {
    case 'loading':
      return 'проверяем…';
    case 'ready':
      return 'Сервис готов';
    case 'unavailable':
      return `Сервис недоступен: ${state.reason}`;
  }
}
