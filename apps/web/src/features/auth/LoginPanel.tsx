import { BUTTON_PRIMARY, PANEL_CLASS } from '../../shared/ui/classes';

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

export function LoginPanel({ error }: { readonly error: string | undefined }) {
  return (
    <section aria-labelledby="login-title" className={PANEL_CLASS}>
      <h2 id="login-title" className="font-display text-lg font-bold">
        Вход
      </h2>
      <div className="mt-4 flex flex-col gap-4">
        {error ? (
          <p role="alert" className="rounded-xl bg-error-container p-3 text-on-error-container">
            {loginErrorMessage(error)}
          </p>
        ) : null}
        <p className="text-on-surface-variant">
          Вход открыт только участникам организации iilmchat.
        </p>
        <div>
          <a href="/api/v1/auth/github/start" className={`${BUTTON_PRIMARY} no-underline`}>
            Войти через GitHub
          </a>
        </div>
      </div>
    </section>
  );
}
