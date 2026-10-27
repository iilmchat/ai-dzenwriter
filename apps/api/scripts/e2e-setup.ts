import { createHash, randomBytes } from 'node:crypto';
import { and, eq, inArray, isNull, like } from 'drizzle-orm';
import { articles, createDatabase, facts, sessions, users } from '@dzenwriter/db';

const AUTHOR_LOGIN = 'e2e-author';
const REVIEWER_LOGIN = 'e2e-reviewer';
const AUTHOR_GITHUB_ID = 990001;
const REVIEWER_GITHUB_ID = 990002;
const FACT_SOURCE_URL = 'https://example.com/e2e-main-flow';
const FACT_TEXT = 'E2E: источник подтверждает сценарий публикации материала.';
const FACT_SOURCE_NAME = 'E2E-источник';
const FACT_SOURCE_DATE = '2026-10-20';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

interface E2ESetup {
  readonly authorToken: string;
  readonly reviewerToken: string;
  readonly factId: string;
}

// Подготавливает изолированных пользователей, факт и сессии для главного E2E-сценария.
// Скрипт идемпотентен: пользователи и факт переиспользуются между прогонами.
async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('E2E setup нельзя запускать при NODE_ENV=production');
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Для E2E нужен DATABASE_URL');
  }

  const { client, db } = createDatabase(databaseUrl, { max: 1 });
  try {
    // Версии статей append-only, поэтому старые E2E-материалы не удаляем, а прячем в архив:
    // на доске остаются только данные текущего прогона. Префикс E2E общий для всех прогонов.
    await db
      .update(articles)
      .set({ status: 'archived', archivedAt: new Date(), updatedAt: new Date() })
      .where(like(articles.topic, 'E2E%'));

    const author = await ensureUser(db, {
      githubId: AUTHOR_GITHUB_ID,
      login: AUTHOR_LOGIN,
      name: 'E2E автор',
      role: 'author',
    });
    const reviewer = await ensureUser(db, {
      githubId: REVIEWER_GITHUB_ID,
      login: REVIEWER_LOGIN,
      name: 'E2E ревьюер',
      role: 'reviewer',
    });

    const [existingFact] = await db
      .select({ id: facts.id })
      .from(facts)
      .where(and(eq(facts.type, 'news_source'), eq(facts.sourceUrl, FACT_SOURCE_URL)))
      .limit(1);

    let factId = existingFact?.id;
    if (factId === undefined) {
      const [createdFact] = await db
        .insert(facts)
        .values({
          type: 'news_source',
          text: FACT_TEXT,
          sourceName: FACT_SOURCE_NAME,
          sourceUrl: FACT_SOURCE_URL,
          sourcePublishedAt: FACT_SOURCE_DATE,
          status: 'approved',
          createdBy: author.id,
          approvedBy: reviewer.id,
          approvedAt: new Date(),
        })
        .returning({ id: facts.id });
      if (!createdFact) {
        throw new Error('Не удалось создать E2E-факт');
      }
      factId = createdFact.id;
    } else {
      // Повторный прогон не должен зависеть от того, что факт успели отклонить вручную.
      // updatedAt поднимаем заново: список библиотеки отдаёт свежие 500 записей,
      // и без этого старый факт выпадает из списка, когда в базе накопилось больше.
      await db
        .update(facts)
        .set({
          text: FACT_TEXT,
          sourceName: FACT_SOURCE_NAME,
          sourcePublishedAt: FACT_SOURCE_DATE,
          status: 'approved',
          createdBy: author.id,
          approvedBy: reviewer.id,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(facts.id, factId));
    }

    // Старые сессии этих тестовых пользователей не нужны: не копим их в локальной базе.
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(inArray(sessions.userId, [author.id, reviewer.id]), isNull(sessions.revokedAt)));

    const authorToken = await createSession(db, author.id);
    const reviewerToken = await createSession(db, reviewer.id);
    const setup: E2ESetup = { authorToken, reviewerToken, factId };
    process.stdout.write(`${JSON.stringify(setup)}\n`);
  } finally {
    await client.end({ timeout: 5 });
  }
}

async function ensureUser(
  db: ReturnType<typeof createDatabase>['db'],
  input: {
    readonly githubId: number;
    readonly login: string;
    readonly name: string;
    readonly role: 'author' | 'reviewer';
  },
): Promise<{ readonly id: string }> {
  const [user] = await db
    .insert(users)
    .values(input)
    .onConflictDoUpdate({
      target: users.login,
      set: { name: input.name, role: input.role, disabledAt: null },
    })
    .returning({ id: users.id });
  if (!user) {
    throw new Error(`Не удалось подготовить пользователя ${input.login}`);
  }
  return user;
}

async function createSession(
  db: ReturnType<typeof createDatabase>['db'],
  userId: string,
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.insert(sessions).values({
    userId,
    tokenHash: createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return token;
}

void main();
