import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { GITHUB_OAUTH } from '../src/auth/github.client';
import { parseEnv, type Env } from '../src/config/env';
import { ENV } from '../src/config/tokens';
import { IDENTITY_REPOSITORY } from '../src/identity/identity.repository';
import { FakeGithubOAuth } from './support/fake-github';
import { InMemoryIdentityRepository } from './support/in-memory-identity.repository';

const WEB_ORIGIN = 'http://localhost:8080';

// Из Set-Cookie достаём значение конкретной cookie.
function cookieValue(response: Response, name: string): string | undefined {
  const header = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
  return header?.split(';')[0]?.slice(name.length + 1);
}

describe('вход, сессии и роли по HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  let github: FakeGithubOAuth;
  let repository: InMemoryIdentityRepository;
  let adminCookie = '';
  let authorCookie = '';
  let authorId = '';

  beforeAll(async () => {
    const env: Env = parseEnv({
      DATABASE_URL: 'postgres://nobody:nobody@127.0.0.1:1/none',
      WEB_ORIGIN,
      GITHUB_CLIENT_ID: 'client-id',
      GITHUB_CLIENT_SECRET: 'client-secret',
      ADMIN_GITHUB_LOGINS: 'anna',
    });
    github = new FakeGithubOAuth();
    repository = new InMemoryIdentityRepository();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ENV)
      .useValue(env)
      .overrideProvider(GITHUB_OAUTH)
      .useValue(github)
      .overrideProvider(IDENTITY_REPOSITORY)
      .useValue(repository)
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app, env, pino({ level: 'silent' }));
    await app.listen(0, '127.0.0.1');

    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') {
      throw new Error('Сервер не получил порт');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  // Возврат с code и state: ответ нужен и для успеха, и для проверки ошибок.
  async function callbackWithState(): Promise<Response> {
    const start = await fetch(`${baseUrl}/api/v1/auth/github/start`, { redirect: 'manual' });
    const state = cookieValue(start, 'dzw_oauth_state') ?? '';
    return fetch(`${baseUrl}/api/v1/auth/github/callback?code=code-1&state=${state}`, {
      redirect: 'manual',
      headers: { Cookie: `dzw_oauth_state=${state}` },
    });
  }

  // Полный вход: старт, возврат с code и state, выдача cookie сессии.
  async function signIn(): Promise<{ sessionCookie: string; location: string }> {
    const callback = await callbackWithState();
    return {
      sessionCookie: cookieValue(callback, 'dzw_session') ?? '',
      location: callback.headers.get('location') ?? '',
    };
  }

  it('старт входа ведёт на GitHub и кладёт state в HttpOnly cookie', async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/github/start`, { redirect: 'manual' });

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.origin).toBe('https://github.com');
    const cookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith('dzw_oauth_state='));
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/api/v1/auth/github');
    expect(location.searchParams.get('state')).toBe(cookieValue(response, 'dzw_oauth_state'));
  });

  it('callback с чужим state возвращает на главную с кодом ошибки', async () => {
    const response = await fetch(
      `${baseUrl}/api/v1/auth/github/callback?code=code-1&state=attacker`,
      { redirect: 'manual', headers: { Cookie: 'dzw_oauth_state=victim' } },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`${WEB_ORIGIN}/login?error=state`);
  });

  it('участник организации входит, первый администратор получает роль admin', async () => {
    const result = await signIn();

    expect(result.location).toBe(`${WEB_ORIGIN}/`);
    expect(result.sessionCookie).not.toBe('');
    adminCookie = `dzw_session=${result.sessionCookie}`;

    const me = await fetch(`${baseUrl}/api/v1/me`, { headers: { Cookie: adminCookie } });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ login: 'anna', role: 'admin' });
  });

  it('без cookie сессии /me отвечает 401 в формате problem+json', async () => {
    const response = await fetch(`${baseUrl}/api/v1/me`);

    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    expect(await response.json()).toMatchObject({ status: 401, detail: 'Требуется вход' });
  });

  it('не участник организации получает отказ с кодом not_member', async () => {
    github.membership = undefined;
    try {
      const result = await signIn();

      expect(result.location).toBe(`${WEB_ORIGIN}/login?error=not_member`);
      expect(result.sessionCookie).toBe('');
    } finally {
      github.membership = 'active';
    }
  });

  it('участник организации без администраторских прав получает роль author', async () => {
    github.profile = { id: 2002, login: 'boris', name: 'Борис' };
    try {
      const result = await signIn();
      authorCookie = `dzw_session=${result.sessionCookie}`;
      const me = await fetch(`${baseUrl}/api/v1/me`, { headers: { Cookie: authorCookie } });
      const body = (await me.json()) as { id: string; role: string };
      authorId = body.id;
      expect(body.role).toBe('author');
    } finally {
      github.profile = { id: 1001, login: 'anna', name: 'Анна Иванова' };
    }
  });

  it('автор не видит список пользователей, администратор видит', async () => {
    const forbidden = await fetch(`${baseUrl}/api/v1/users`, { headers: { Cookie: authorCookie } });
    expect(forbidden.status).toBe(403);

    const allowed = await fetch(`${baseUrl}/api/v1/users`, { headers: { Cookie: adminCookie } });
    expect(allowed.status).toBe(200);
    const body = (await allowed.json()) as { items: { login: string }[] };
    expect(body.items.map((item) => item.login).sort()).toEqual(['anna', 'boris']);
  });

  it('чужой Origin на изменяющем запросе отклоняется', async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { Cookie: adminCookie, Origin: 'https://evil.example' },
    });

    expect(response.status).toBe(403);
    const me = await fetch(`${baseUrl}/api/v1/me`, { headers: { Cookie: adminCookie } });
    expect(me.status).toBe(200);
  });

  it('администратор отключает пользователя: его сессия перестаёт работать', async () => {
    const response = await fetch(`${baseUrl}/api/v1/users/${authorId}`, {
      method: 'PATCH',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabled: true }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: authorId, disabled: true });
    const me = await fetch(`${baseUrl}/api/v1/me`, { headers: { Cookie: authorCookie } });
    expect(me.status).toBe(401);
  });

  it('ошибки ввода для изменения пользователя объясняются по-русски', async () => {
    const patch = (id: string, body: unknown) =>
      fetch(`${baseUrl}/api/v1/users/${id}`, {
        method: 'PATCH',
        headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

    const badRole = await patch(authorId, { role: 'owner' });
    expect(badRole.status).toBe(400);
    expect(await badRole.json()).toMatchObject({
      detail: 'Роль должна быть author, reviewer или admin',
    });

    const empty = await patch(authorId, {});
    expect(await empty.json()).toMatchObject({ detail: 'Укажите роль или признак отключения' });

    const badId = await patch('not-a-uuid', { role: 'reviewer' });
    expect(await badId.json()).toMatchObject({
      detail: 'Некорректный идентификатор пользователя',
    });
  });

  it('администратор не может понизить себя', async () => {
    const me = await fetch(`${baseUrl}/api/v1/me`, { headers: { Cookie: adminCookie } });
    const { id } = (await me.json()) as { id: string };

    const response = await fetch(`${baseUrl}/api/v1/users/${id}`, {
      method: 'PATCH',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'author' }),
    });

    expect(response.status).toBe(403);
  });

  it('выход отзывает сессию', async () => {
    const logout = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { Cookie: adminCookie, Origin: WEB_ORIGIN },
    });
    expect(logout.status).toBe(204);

    const me = await fetch(`${baseUrl}/api/v1/me`, { headers: { Cookie: adminCookie } });
    expect(me.status).toBe(401);
  });

  it('смена логина на занятый возвращает 409, пишет аудит и не меняет логин', async () => {
    const alice = repository.addUser({ githubId: 11, login: 'conflict-alice' });
    const bob = repository.addUser({ githubId: 12, login: 'conflict-bob' });
    github.profile = { id: 11, login: 'conflict-bob', name: 'Alice' };
    try {
      const response = await callbackWithState();

      expect(response.status).toBe(409);
      expect(response.headers.get('content-type')).toContain('application/problem+json');
      expect(await response.json()).toMatchObject({
        type: 'about:blank',
        title: 'Конфликт логина GitHub',
        status: 409,
        detail: 'Пользователь с логином conflict-bob уже существует. Обратитесь к администратору.',
      });

      const conflictAudit = repository.audit
        .filter((record) => record.action === 'auth.login_conflict')
        .at(-1);
      expect(conflictAudit).toMatchObject({
        actorId: alice.id,
        entityType: 'user',
        entityId: alice.id,
        payload: {
          githubId: 11,
          conflictingUserId: bob.id,
          existingUser: true,
        },
      });
      expect([...repository.users.values()].find((user) => user.id === alice.id)?.login).toBe(
        'conflict-alice',
      );
    } finally {
      github.profile = { id: 1001, login: 'anna', name: 'Анна Иванова' };
    }
  });

  it('новый github_id с занятым логином возвращает 409 с понятным текстом', async () => {
    const bob = repository.addUser({ githubId: 22, login: 'taken-login' });
    github.profile = { id: 23, login: 'taken-login', name: 'Новый' };
    try {
      const response = await callbackWithState();

      expect(response.status).toBe(409);
      expect(response.headers.get('content-type')).toContain('application/problem+json');
      const body = (await response.json()) as { detail: string };
      expect(body.detail).toContain('уже существует');

      const conflictAudit = repository.audit
        .filter((record) => record.action === 'auth.login_conflict')
        .at(-1);
      expect(conflictAudit).toMatchObject({
        actorId: null,
        entityId: 'unknown',
        payload: {
          githubId: 23,
          conflictingUserId: bob.id,
          existingUser: false,
        },
      });
      expect([...repository.users.values()].some((user) => user.githubId === 23)).toBe(false);
    } finally {
      github.profile = { id: 1001, login: 'anna', name: 'Анна Иванова' };
    }
  });

  it('health остаётся открытым без входа', async () => {
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
  });
});
