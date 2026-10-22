// Служебный скрипт локальной проверки: создаёт сессию для пользователя из базы.
// Нужен, когда OAuth-секреты не настроены, а интерфейс и API надо посмотреть в браузере.
// Токен печатается в stdout: его нужно положить в cookie dzw_session.
// Сессия живёт сутки; в базе хранится только SHA-256 токена.
import { createDatabase, sessions, users } from '@dzenwriter/db';
import { eq } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';

const database = createDatabase(process.env.DATABASE_URL ?? '');
const login = process.argv[2] ?? 'demo-author';

async function main(): Promise<void> {
  const [user] = await database.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.login, login))
    .limit(1);
  if (!user) {
    throw new Error(`Нет пользователя ${login}`);
  }

  const token = randomBytes(32).toString('base64url');
  await database.db.insert(sessions).values({
    userId: user.id,
    tokenHash: createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  process.stdout.write(`${token}\n`);
}

void main().finally(async () => {
  await database.client.end({ timeout: 5 });
});
