// Периодическая перепроверка членства в организации (P1-13, ADR-0005).
// Доступ отзывается не только при следующем входе: раз в сутки скрипт спрашивает GitHub
// про каждого пользователя с активной сессией и отключает тех, кого в организации больше нет.
// Перепроверяем только реально входивших через GitHub (запись auth.login в журнале):
// демо-пользователи и служебные сессии не проверяются.

export interface MembershipTarget {
  readonly userId: string;
  readonly login: string;
}

export interface MembershipStore {
  // Активные сессии + входившие через GitHub + не отключённые: кого перепроверяем.
  listMembersToRecheck(): Promise<MembershipTarget[]>;
  // Отключение одной транзакцией: сессии отозваны, в журнале — user.membership_lost с организацией.
  disableForMembershipLoss(userId: string, org: string, now: Date): Promise<number>;
}

// Вердикт GitHub по одному пользователю.
export type MembershipVerdict = 'member' | 'not_member' | 'token_invalid';

export interface MembershipClient {
  check(login: string): Promise<MembershipVerdict>;
}

export interface RecheckSummary {
  readonly checked: number;
  readonly revoked: number;
  readonly skipped: number;
  readonly tokenInvalid: boolean;
}

export async function recheckMembership(
  store: MembershipStore,
  client: MembershipClient,
  org: string,
  now: Date,
): Promise<RecheckSummary> {
  const targets = await store.listMembersToRecheck();
  let checked = 0;
  let disabled = 0;
  let tokenInvalid = false;

  for (const target of targets) {
    const verdict = await client.check(target.login);
    if (verdict === 'member') {
      checked += 1;
      continue;
    }
    if (verdict === 'not_member') {
      await store.disableForMembershipLoss(target.userId, org, now);
      disabled += 1;
      checked += 1;
      continue;
    }
    // Токен невалиден: вердиктов больше нет, остальных не отключаем.
    tokenInvalid = true;
    break;
  }

  return {
    checked,
    revoked: disabled,
    skipped: targets.length - checked,
    tokenInvalid,
  };
}
