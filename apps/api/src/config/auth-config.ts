import { ConfigError } from './errors';
import type { Env } from './env';

export interface GithubAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly org: string;
  readonly adminLogins: readonly string[];
  readonly callbackUrl: string;
}

export interface AuthConfig {
  readonly webOrigin: string;
  readonly secureCookies: boolean;
  readonly github: GithubAuthConfig | undefined;
}

// Вход включён, только когда заданы оба секрета OAuth App. Без них сервис работает,
// а вход отвечает понятной ошибкой: /health и /ready от входа не зависят.
export function resolveAuthConfig(env: Env): AuthConfig {
  const webOrigin = new URL(env.WEB_ORIGIN).origin;
  const secureCookies = webOrigin.startsWith('https://');
  const { GITHUB_CLIENT_ID: clientId, GITHUB_CLIENT_SECRET: clientSecret } = env;

  if (!clientId && !clientSecret) {
    return { webOrigin, secureCookies, github: undefined };
  }
  if (!clientId || !clientSecret) {
    throw new ConfigError('GITHUB_CLIENT_ID и GITHUB_CLIENT_SECRET нужно задать вместе');
  }

  return {
    webOrigin,
    secureCookies,
    github: {
      clientId,
      clientSecret,
      org: env.GITHUB_ORG,
      adminLogins: parseLogins(env.ADMIN_GITHUB_LOGINS),
      callbackUrl: new URL('/api/v1/auth/github/callback', webOrigin).toString(),
    },
  };
}

// Логины GitHub регистронезависимы, поэтому сравниваем их в нижнем регистре.
export function parseLogins(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((login) => login.trim().toLowerCase())
    .filter((login) => login.length > 0);
}
