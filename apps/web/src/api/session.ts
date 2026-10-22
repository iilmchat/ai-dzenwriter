import { currentUserSchema, type CurrentUser } from '@dzenwriter/shared';

export type SessionState =
  | { phase: 'loading' }
  | { phase: 'anonymous' }
  | { phase: 'authenticated'; user: CurrentUser }
  | { phase: 'unavailable' };

// 401 означает «не вошли». Остальное проверяется той же схемой, что и на сервере.
export async function fetchSession(): Promise<SessionState> {
  try {
    const response = await fetch('/api/v1/me', { headers: { Accept: 'application/json' } });
    if (response.status === 401) {
      return { phase: 'anonymous' };
    }
    if (!response.ok) {
      return { phase: 'unavailable' };
    }
    return { phase: 'authenticated', user: currentUserSchema.parse(await response.json()) };
  } catch {
    return { phase: 'unavailable' };
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch('/api/v1/auth/logout', { method: 'POST' });
  } catch {
    // Сессия истечёт сама по сроку, а интерфейс всё равно вернётся к экрану входа.
  }
}
