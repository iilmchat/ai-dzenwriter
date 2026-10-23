// Эксплуатационный скрипт: удаляет истёкшие и отозванные сессии.
// Запускается по расписанию на хосте или внутри контейнера api.
import { createDatabase } from '@dzenwriter/db';
import { DrizzleIdentityRepository } from '../identity/drizzle-identity.repository';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL не задан');
    process.exitCode = 1;
    return;
  }

  const { client, db } = createDatabase(url, { max: 1 });
  try {
    const repository = new DrizzleIdentityRepository(db);
    const deleted = await repository.deleteInactiveSessions(new Date());
    console.log(`Удалено сессий: ${deleted}`);
  } finally {
    await client.end({ timeout: 5 });
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
