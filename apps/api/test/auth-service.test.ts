import { describe, expect, it } from 'vitest';
import { AuthService, type LoginResult } from '../src/auth/auth.service';
import { SESSION_TTL_MS } from '../src/auth/cookies';
import { hashSessionToken } from '../src/auth/session-token';
import type { AuthConfig } from '../src/config/auth-config';
import { FakeGithubOAuth } from './support/fake-github';
import { InMemoryIdentityRepository } from './support/in-memory-identity.repository';

const github = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  org: 'iilmchat',
  adminLogins: ['anna'],
  callbackUrl: 'http://localhost:8080/api/v1/auth/github/callback',
};
const config: AuthConfig = { webOrigin: 'http://localhost:8080', secureCookies: false, github };
const NOW = new Date('2026-10-22T10:00:00Z');

function setup() {
  const fake = new FakeGithubOAuth();
  const repository = new InMemoryIdentityRepository();
  const auth = new AuthService(config, fake, repository);
  return { auth, fake, repository };
}

async function login(auth: AuthService, state = 'state-1', now = NOW): Promise<LoginResult> {
  return auth.completeLogin({ code: 'code-1', state, expectedState: state, now });
}

function tokenOf(result: LoginResult): string {
  if (!result.ok) {
    throw new Error(`Вход не выполнен: ${result.reason}`);
  }
  return result.sessionToken;
}

describe('AuthService.beginLogin', () => {
  it('строит ссылку на GitHub с нужными scope и state', () => {
    const { auth } = setup();

    const { state, url } = auth.beginLogin();
    const parsed = new URL(url);

    expect(`${parsed.origin}${parsed.pathname}`).toBe('https://github.com/login/oauth/authorize');
    expect(parsed.searchParams.get('scope')).toBe('read:user read:org');
    expect(parsed.searchParams.get('redirect_uri')).toBe(github.callbackUrl);
    expect(parsed.searchParams.get('state')).toBe(state);
    expect(parsed.searchParams.get('allow_signup')).toBe('false');
  });
});

describe('AuthService.completeLogin', () => {
  it('отклоняет state, который не совпадает с cookie, и не обращается к GitHub', async () => {
    const { auth, fake } = setup();

    const result = await auth.completeLogin({
      code: 'code-1',
      state: 'attacker',
      expectedState: 'victim',
      now: NOW,
    });

    expect(result).toEqual({ ok: false, reason: 'state' });
    expect(fake.exchangedCodes).toEqual([]);
  });

  it('отклоняет вход без cookie со state', async () => {
    const { auth } = setup();

    const result = await auth.completeLogin({
      code: 'code-1',
      state: 'state-1',
      expectedState: undefined,
      now: NOW,
    });

    expect(result).toEqual({ ok: false, reason: 'state' });
  });

  it('не участник организации получает отказ и запись в аудит без персональных данных', async () => {
    const { auth, fake, repository } = setup();
    fake.membership = undefined;

    const result = await login(auth);

    expect(result).toEqual({ ok: false, reason: 'not_member' });
    expect(repository.users.size).toBe(0);
    expect(repository.audit).toEqual([
      {
        actorId: null,
        action: 'auth.denied',
        entityType: 'auth',
        entityId: 'github',
        payload: { reason: 'not_member' },
      },
    ]);
  });

  it('участник организации получает автора и сессию, в БД лежит только хеш токена', async () => {
    const { auth, fake, repository } = setup();
    fake.profile = { id: 2002, login: 'boris', name: 'Борис' };

    const result = await login(auth);

    expect(result.ok).toBe(true);
    const token = tokenOf(result);
    const [user] = [...repository.users.values()];
    expect(user).toMatchObject({ login: 'boris', role: 'author', disabledAt: null });
    const [session] = [...repository.sessions.values()];
    expect(session?.tokenHash).toBe(hashSessionToken(token));
    expect(session?.tokenHash).not.toBe(token);
    expect(session?.expiresAt.getTime()).toBe(NOW.getTime() + SESSION_TTL_MS);
    expect(repository.audit.at(-1)).toMatchObject({
      actorId: user?.id,
      action: 'auth.login',
      payload: { created: true, bootstrapAdmin: false },
    });
  });

  it('первый вход логина из ADMIN_GITHUB_LOGINS даёт роль администратора, без учёта регистра', async () => {
    const { auth, fake, repository } = setup();
    fake.profile = { id: 3003, login: 'Anna', name: null };

    await login(auth);

    expect([...repository.users.values()][0]?.role).toBe('admin');
  });

  it('не повышает логин из списка, если администратор уже есть', async () => {
    const { auth, fake, repository } = setup();
    repository.addUser({ githubId: 9, login: 'chief', role: 'admin' });
    fake.profile = { id: 3003, login: 'anna', name: null };

    await login(auth);

    const anna = [...repository.users.values()].find((user) => user.login === 'anna');
    expect(anna?.role).toBe('author');
  });

  it('отключённый пользователь не входит и не получает сессию', async () => {
    const { auth, repository } = setup();
    const disabled = repository.addUser({
      githubId: 1001,
      login: 'anna',
      disabledAt: NOW,
    });

    const result = await login(auth);

    expect(result).toEqual({ ok: false, reason: 'disabled' });
    expect(repository.sessions.size).toBe(0);
    expect(repository.audit.at(-1)).toMatchObject({
      actorId: disabled.id,
      action: 'auth.denied',
      payload: { reason: 'disabled' },
    });
  });

  it('ошибка GitHub становится отказом, а не падением сервиса', async () => {
    const { auth, fake } = setup();
    fake.exchangeError = true;

    expect(await login(auth)).toEqual({ ok: false, reason: 'github' });
  });
});

describe('AuthService сессии', () => {
  it('действующая сессия возвращает пользователя', async () => {
    const { auth } = setup();
    const token = tokenOf(await login(auth));

    const user = await auth.findSession(token, NOW);

    expect(user).toMatchObject({ login: 'anna', role: 'admin' });
  });

  it('истёкшая сессия не действует', async () => {
    const { auth } = setup();
    const token = tokenOf(await login(auth));

    const later = new Date(NOW.getTime() + SESSION_TTL_MS + 1000);

    expect(await auth.findSession(token, later)).toBeUndefined();
  });

  it('выход отзывает сессию и пишет запись в аудит', async () => {
    const { auth, repository } = setup();
    const token = tokenOf(await login(auth));

    await auth.logout(token, NOW);

    expect(await auth.findSession(token, NOW)).toBeUndefined();
    expect(repository.audit.at(-1)).toMatchObject({ action: 'auth.logout' });
  });

  it('отключение пользователя закрывает его сессии', async () => {
    const { auth, repository } = setup();
    const token = tokenOf(await login(auth));
    const [user] = [...repository.users.values()];
    if (!user) {
      throw new Error('Пользователь не создан');
    }
    repository.users.set(user.id, { ...user, disabledAt: NOW });

    expect(await auth.findSession(token, NOW)).toBeUndefined();
  });
});
