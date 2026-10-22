import type { CookieOptions } from 'express';

export const SESSION_COOKIE = 'dzw_session';
export const OAUTH_STATE_COOKIE = 'dzw_oauth_state';
export const OAUTH_CALLBACK_PATH = '/api/v1/auth/github';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

// HttpOnly: скрипты страницы не читают токен. SameSite=Lax: cookie не уходит с чужих POST.
// Secure включается, когда приложение открыто по https (в продакшене).
export function cookieAttributes(secure: boolean, path: string): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure, path };
}

export function sessionCookieOptions(secure: boolean): CookieOptions {
  return { ...cookieAttributes(secure, '/'), maxAge: SESSION_TTL_MS };
}

export function oauthStateCookieOptions(secure: boolean): CookieOptions {
  return { ...cookieAttributes(secure, OAUTH_CALLBACK_PATH), maxAge: OAUTH_STATE_TTL_MS };
}

// Токены в base64url, поэтому заголовок cookie разбираем без декодирования.
export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator !== -1 && part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim() || undefined;
    }
  }
  return undefined;
}
