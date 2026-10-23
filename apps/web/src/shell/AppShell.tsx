import { USER_ROLE_LABELS } from '@dzenwriter/shared';
import { Link, NavLink, Outlet } from 'react-router';
import logoIcon from '../../../../design/brand/logo-icon.svg?url';
import { useSession } from '../session/SessionContext';
import { BUTTON_SECONDARY, FOCUS_RING } from '../shared/ui/classes';
import { ServiceStatus } from './ServiceStatus';

export function AppShell() {
  const { state, signOut } = useSession();
  const user = state.phase === 'authenticated' ? state.user : undefined;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-outline-variant bg-surface-container">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-8 gap-y-3 px-6 py-4">
          <Link to="/" className={`flex items-center gap-3 rounded-lg ${FOCUS_RING}`}>
            <img src={logoIcon} alt="" width={36} height={36} />
            <span className="font-display text-xl font-bold">DzenWriter</span>
          </Link>
          <nav aria-label="Основная навигация" className="flex flex-wrap gap-2 text-sm font-medium">
            <NavLink to="/" end className={navClass}>
              Доска
            </NavLink>
            <NavLink to="/facts" className={navClass}>
              Факт-база
            </NavLink>
            <NavLink to="/products" className={navClass}>
              Продукты
            </NavLink>
            <NavLink to="/publications" className={navClass}>
              Публикации
            </NavLink>
            <NavLink to="/metrics" className={navClass}>
              Метрики
            </NavLink>
            <NavLink to="/styles" className={navClass}>
              Стили и форматы
            </NavLink>
            {user?.role === 'admin' ? (
              <>
                <NavLink to="/admin/pilot" className={navClass}>
                  Пилот
                </NavLink>
                <NavLink to="/admin/users" className={navClass}>
                  Пользователи
                </NavLink>
              </>
            ) : null}
          </nav>
          {user ? (
            <div className="ml-auto flex items-center gap-3 text-sm">
              <span>
                {user.name ?? user.login} · {USER_ROLE_LABELS[user.role]}
              </span>
              <button type="button" onClick={() => void signOut()} className={BUTTON_SECONDARY}>
                Выйти
              </button>
            </div>
          ) : null}
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
        <Outlet />
      </main>
      <footer className="border-t border-outline-variant">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-6 py-4">
          <ServiceStatus />
          <span className="text-sm text-on-surface-variant">
            Фокус v1: ИИ — агенты, LLM-системы и их внедрение.
          </span>
        </div>
      </footer>
    </div>
  );
}

function navClass({ isActive }: { isActive: boolean }): string {
  const state = isActive
    ? 'bg-secondary-container text-on-secondary-container'
    : 'hover:bg-surface';
  return `rounded-full px-3 py-1.5 ${state} ${FOCUS_RING}`;
}
