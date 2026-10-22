import { useEffect, useState } from 'react';
import logoIcon from '../../../design/brand/logo-icon.svg?url';
import logoIconWhite from '../../../design/brand/logo-icon-white.svg?url';
import { fetchReadiness, type ReadinessState } from './api/readiness';

export function App() {
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
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-6 py-12">
      <header className="flex items-center gap-4">
        <picture>
          <source media="(prefers-color-scheme: dark)" srcSet={logoIconWhite} />
          <img src={logoIcon} alt="" width={48} height={48} />
        </picture>
        <div>
          <h1 className="font-display text-3xl font-bold">DzenWriter</h1>
          <p className="text-on-surface-variant">
            Внутренний инструмент IIRuChating для статей в Яндекс Дзен
          </p>
        </div>
      </header>

      <section
        aria-labelledby="status-title"
        className="rounded-2xl border border-outline-variant bg-surface-container p-6"
      >
        <h2 id="status-title" className="font-display text-lg font-bold">
          Состояние сервиса
        </h2>
        <p role="status" className="mt-3 text-base font-medium">
          {statusText(state)}
        </p>
        <Details state={state} />
      </section>

      <footer className="text-sm text-on-surface-variant">
        Фокус v1: ИИ — агенты, LLM-системы и их внедрение.
      </footer>
    </main>
  );
}

function statusText(state: ReadinessState): string {
  switch (state.phase) {
    case 'loading':
      return 'Проверяем состояние…';
    case 'ready':
      return 'Сервис готов';
    case 'unavailable':
      return `Сервис недоступен: ${state.reason}`;
  }
}

function Details({ state }: { state: ReadinessState }) {
  if (state.phase === 'loading') {
    return null;
  }

  const apiReachable = state.response !== undefined;
  const database = state.phase === 'ready' ? 'ok' : state.response?.checks.database;

  return (
    <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
      <dt className="text-on-surface-variant">API</dt>
      <dd>{apiReachable ? 'отвечает' : 'не отвечает'}</dd>
      <dt className="text-on-surface-variant">База данных</dt>
      <dd>
        {database === 'ok' ? 'подключена' : database === 'error' ? 'недоступна' : 'не проверялась'}
      </dd>
    </dl>
  );
}
