import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';

// Подключение либо корневое, либо транзакционное: так работает withTransaction в репозиториях.
export type DbHandle = PgDatabase<PostgresJsQueryResultHKT, Record<string, never>>;
