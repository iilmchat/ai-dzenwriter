// Перепроверка членства: отключение по вердикту GitHub, остановка при невалидном токене.
import type { AuditRecord } from '../src/audit/audit.record';
import {
  recheckMembership,
  type MembershipClient,
  type MembershipStore,
  type MembershipTarget,
  type MembershipVerdict,
} from '../src/users/membership-recheck';
import { describe, expect, it } from 'vitest';

const NOW = new Date('2026-10-27T09:00:00Z');
const ORG = 'iiruchating';

function makeStore(targets: MembershipTarget[]): {
  store: MembershipStore;
  audit: AuditRecord[];
  disabled: string[];
  revoked: number[];
} {
  const audit: AuditRecord[] = [];
  const disabled: string[] = [];
  const revoked: number[] = [];
  const store: MembershipStore = {
    async listMembersToRecheck(): Promise<MembershipTarget[]> {
      return targets;
    },
    async disableForMembershipLoss(userId: string, org: string, _at: Date): Promise<number> {
      disabled.push(userId);
      const count = targets.find((t) => t.userId === userId) === undefined ? 0 : 2;
      revoked.push(count);
      audit.push({
        actorId: null,
        action: 'user.membership_lost',
        entityType: 'user',
        entityId: userId,
        payload: { org },
      });
      return count;
    },
  };
  return { store, audit, disabled, revoked };
}

function makeClient(verdicts: Record<string, MembershipVerdict>): MembershipClient {
  return {
    async check(login: string): Promise<MembershipVerdict> {
      const verdict = verdicts[login];
      if (verdict === undefined) {
        throw new Error(`Нет вердикта для ${login}`);
      }
      return verdict;
    },
  };
}

describe('перепроверка членства', () => {
  it('участника не трогает, не-участника отключает с отзыва сессий и записью в журнал', async () => {
    const targets = [
      { userId: 'u-member', login: 'iilmchat' },
      { userId: 'u-lost', login: 'former' },
    ];
    const { store, audit, disabled, revoked } = makeStore(targets);

    const summary = await recheckMembership(
      store,
      makeClient({ iilmchat: 'member', former: 'not_member' }),
      ORG,
      NOW,
    );

    expect(summary).toEqual({ checked: 2, revoked: 1, skipped: 0, tokenInvalid: false });
    expect(disabled).toEqual(['u-lost']);
    expect(audit).toEqual([
      expect.objectContaining({
        action: 'user.membership_lost',
        entityId: 'u-lost',
        payload: { org: ORG },
      }),
    ]);
    expect(revoked).toEqual([2]);
  });

  it('невалидный токен останавливает отключения и возвращает остальных как пропущенных', async () => {
    const targets = [
      { userId: 'u-1', login: 'someone' },
      { userId: 'u-2', login: 'someone-else' },
    ];
    const { store, audit, disabled } = makeStore(targets);

    const summary = await recheckMembership(
      store,
      makeClient({ someone: 'token_invalid', 'someone-else': 'member' }),
      ORG,
      NOW,
    );

    expect(summary).toEqual({ checked: 0, revoked: 0, skipped: 2, tokenInvalid: true });
    expect(disabled).toEqual([]);
    expect(audit).toEqual([]);
  });

  it('на пустом списке ничего не делает', async () => {
    const { store } = makeStore([]);

    const summary = await recheckMembership(store, makeClient({}), ORG, NOW);

    expect(summary).toEqual({ checked: 0, revoked: 0, skipped: 0, tokenInvalid: false });
  });
});
