import { createHash, randomBytes } from 'node:crypto';

// Непрозрачный токен: состояние не кодируется в нём, поэтому его можно отозвать в БД.
export function createOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

// В БД хранится только SHA-256 от токена: утечка таблицы не даёт действующих сессий.
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
