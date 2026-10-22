import type { UserRole } from '@dzenwriter/shared';
import type { SessionState } from '../../api/session';

const ROLE_LABELS: Record<UserRole, string> = {
  author: 'Автор',
  reviewer: 'Ревьюер',
  admin: 'Администратор',
};

const LOGIN_ERRORS: Record<string, string> = {
  not_member:
    'Вход доступен только участникам организации iilmchat. Если вы в ней состоите, попросите администратора проверить доступ.',
  disabled: 'Доступ отключён администратором. Если это ошибка, обратитесь к администратору.',
  state: 'Сессия входа устарела. Нажмите «Войти через GitHub» ещё раз.',
  github: 'GitHub не ответил на запрос входа. Попробуйте ещё раз.',
  denied: 'Вход отменён. Чтобы войти, подтвердите доступ на GitHub.',
  unavailable: 'Вход через GitHub не настроен на сервере. Обратитесь к администратору.',
};

const DEFAULT_LOGIN_ERROR = 'Не удалось войти. Попробуйте ещё раз.';

export function loginErrorMessage(code: string): string {
  return LOGIN_ERRORS[code] ?? DEFAULT_LOGIN_ERROR;
}

const BUTTON_CLASSES =
  'inline-flex items-center rounded-full px-5 py-2.5 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

interface AuthSectionProps {
  readonly session: SessionState;
  readonly error: string | undefined;
  readonly onLogout: () => void;
}

export function AuthSection({ session, error, onLogout }: AuthSectionProps) {
  return (
    <section
      aria-labelledby="auth-title"
      className="rounded-2xl border border-outline-variant bg-surface-container p-6"
    >
      <h2 id="auth-title" className="font-display text-lg font-bold">
        Вход
      </h2>
      <AuthBody session={session} error={error} onLogout={onLogout} />
    </section>
  );
}

function AuthBody({ session, error, onLogout }: AuthSectionProps) {
  switch (session.phase) {
    case 'loading':
      return <p className="mt-3 text-base">Проверяем вход…</p>;
    case 'unavailable':
      return <p className="mt-3 text-base">Не удалось проверить вход. Обновите страницу.</p>;
    case 'authenticated':
      return (
        <div className="mt-3 flex flex-col gap-4">
          <p className="text-base">
            Вы вошли как{' '}
            <span className="font-medium">{session.user.name ?? session.user.login}</span>. Роль:{' '}
            {ROLE_LABELS[session.user.role]}.
          </p>
          <div>
            <button
              type="button"
              onClick={onLogout}
              className={`${BUTTON_CLASSES} border border-outline-variant`}
            >
              Выйти
            </button>
          </div>
        </div>
      );
    case 'anonymous':
      return (
        <div className="mt-3 flex flex-col gap-4">
          {error ? (
            <p role="alert" className="rounded-xl bg-error-container p-3 text-on-error-container">
              {loginErrorMessage(error)}
            </p>
          ) : null}
          <p className="text-on-surface-variant">
            Вход открыт только участникам организации iilmchat.
          </p>
          <div>
            <a
              href="/api/v1/auth/github/start"
              className={`${BUTTON_CLASSES} bg-primary text-on-primary`}
            >
              Войти через GitHub
            </a>
          </div>
        </div>
      );
  }
}
