import { Navigate, useSearchParams } from 'react-router';
import logoIcon from '../../../../design/brand/logo-icon.svg?url';
import logoIconWhite from '../../../../design/brand/logo-icon-white.svg?url';
import { LoginPanel } from '../features/auth/LoginPanel';
import { useSession } from '../session/SessionContext';
import { ServiceStatus } from '../shell/ServiceStatus';

export function LoginPage() {
  const { state } = useSession();
  const [params] = useSearchParams();

  if (state.phase === 'authenticated') {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-6 py-12">
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
        <LoginPanel error={params.get('error') ?? undefined} />
      </main>
      <footer className="border-t border-outline-variant">
        <div className="mx-auto max-w-2xl px-6 py-4">
          <ServiceStatus />
        </div>
      </footer>
    </div>
  );
}
