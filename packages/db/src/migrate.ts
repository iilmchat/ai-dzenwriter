import path from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase } from './client';

export const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations');

export async function runMigrations(url: string): Promise<void> {
  const { client, db } = createDatabase(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL не задан');
    process.exit(1);
  }

  runMigrations(url)
    .then(() => console.log('Миграции применены'))
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
