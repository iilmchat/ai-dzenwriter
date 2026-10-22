import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export interface DatabaseOptions {
  readonly max?: number;
}

export function createDatabase(url: string, options: DatabaseOptions = {}) {
  const client = postgres(url, {
    max: options.max ?? 10,
    onnotice: () => undefined,
  });

  return { client, db: drizzle(client) };
}

export type Database = ReturnType<typeof createDatabase>['db'];
