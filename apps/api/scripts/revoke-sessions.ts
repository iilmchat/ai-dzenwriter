// Служебный скрипт локальной проверки: отзывает все активные сессии.
// Нужен после ручной проверки в браузере, чтобы токены не оставались рабочими.
import { createDatabase, sessions } from '@dzenwriter/db';
import { isNull } from 'drizzle-orm';

const database = createDatabase(process.env.DATABASE_URL ?? '');

async function main(): Promise<void> {
  const rows = await database.db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(isNull(sessions.revokedAt))
    .returning({ id: sessions.id });
  process.stdout.write(`Отозвано сессий: ${rows.length}\n`);
}

void main().finally(async () => {
  await database.client.end({ timeout: 5 });
});
