// Периодическая перепроверка членства в организации (P1-13): скрипт для cron, раз в сутки.
// Запуск: pnpm --filter @dzenwriter/api membership:recheck
// Нужен GITHUB_ORG_TOKEN с read:org (см. ADR-0005). Без токена перепроверка не активна.
// Не участник → отключение: сессии отозваны, в журнале user.membership_lost.
import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import { auditLog, createDatabase, sessions, users } from '@dzenwriter/db';
import { parseEnv } from '../config/env';
import {
  recheckMembership,
  type MembershipClient,
  type MembershipStore,
  type MembershipTarget,
  type MembershipVerdict,
} from '../users/membership-recheck';

const env = parseEnv(process.env as Record<string, string>);

const token = env.GITHUB_ORG_TOKEN;
if (!token) {
  console.log('GITHUB_ORG_TOKEN не задан: перепроверка членства не активна (ADR-0005)');
  process.exit(0);
}
const org = env.GITHUB_ORG;
const now = new Date();

// GitHub: 204 — участник, 404 — уже не участник, 401/403 — токен невалиден (верди́ть никого нельзя).
class GithubMembershipClient implements MembershipClient {
  async check(login: string): Promise<MembershipVerdict> {
    const response = await fetch(`https://api.github.com/orgs/${org}/members/${login}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (response.status === 204) {
      return 'member';
    }
    if (response.status === 404) {
      return 'not_member';
    }
    if (response.status === 401 || response.status === 403) {
      return 'token_invalid';
    }
    throw new Error(`GitHub ответил ${response.status} для ${login}`);
  }
}

class DrizzleMembershipStore implements MembershipStore {
  constructor(private readonly database: ReturnType<typeof createDatabase>) {}

  async listMembersToRecheck(): Promise<MembershipTarget[]> {
    // Только реальные входы через GitHub (audit.auth.login): демо-пользователи не проверяются.
    const realLogins = this.database.db
      .select({ id: auditLog.actorId })
      .from(auditLog)
      .where(eq(auditLog.action, 'auth.login'));
    const rows = await this.database.db
      .selectDistinct({ userId: users.id, login: users.login })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now),
          isNull(users.disabledAt),
          inArray(users.id, realLogins),
        ),
      );
    return rows.map((row) => ({ userId: row.userId, login: row.login }));
  }

  async disableForMembershipLoss(userId: string, orgName: string, at: Date): Promise<number> {
    return this.database.db.transaction(async (tx) => {
      const disabled = await tx
        .update(users)
        .set({ disabledAt: at })
        .where(and(eq(users.id, userId), isNull(users.disabledAt)))
        .returning({ id: users.id });
      if (disabled.length === 0) {
        return 0;
      }
      const revoked = await tx
        .update(sessions)
        .set({ revokedAt: at })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      await tx.insert(auditLog).values({
        actorId: null,
        action: 'user.membership_lost',
        entityType: 'user',
        entityId: userId,
        payload: { org: orgName },
      });
      return revoked.length;
    });
  }
}

async function main(): Promise<void> {
  const database = createDatabase(process.env.DATABASE_URL ?? '');
  try {
    const summary = await recheckMembership(
      new DrizzleMembershipStore(database),
      new GithubMembershipClient(),
      org,
      now,
    );
    console.log(
      `Перепроверка ${org}: проверено ${summary.checked}, отключено ${summary.revoked}, пропущено ${summary.skipped}${summary.tokenInvalid ? '; ТОКЕН НЕВАЛИДЕН — отключения остановлены' : ''}`,
    );
  } finally {
    await database.client.end({ timeout: 5 });
  }
}

void main();
