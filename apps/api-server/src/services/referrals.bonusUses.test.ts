/**
 * A referral pays in two currencies, and it pays each of them once.
 *
 * Coins are guarded by `wallet_award_once`; bonus AI uses are guarded by the
 * UNIQUE `ai_bonus_grants.source_id`. Both keys are derived from the referral
 * row id, so the two guards agree with each other. What this file pins is that
 * the service actually uses them that way — and that a missing bonus ledger
 * (the window before 20260907140000 is hand-applied) still pays the coins.
 */
const granted: Array<{ userId: string; sourceId: string; amount: number }> = [];
let bonusAvailable = true;

jest.mock('./aiBonusUses', () => ({
  grantBonusUses: jest.fn(
    async (
      userId: string,
      params: { sourceId: string; amount: number; cap?: number }
    ) => {
      if (!bonusAvailable) {
        return { granted: false, amount: 0, balance: 0, capped: false, unavailable: true };
      }
      if (granted.some((g) => g.sourceId === params.sourceId)) {
        return { granted: false, amount: 0, balance: 0, capped: false };
      }
      granted.push({ userId, sourceId: params.sourceId, amount: params.amount });
      return { granted: true, amount: params.amount, balance: params.amount, capped: false };
    }
  ),
}));

const walletAwards: string[] = [];
jest.mock('./walletService', () => ({
  getWalletService: () => ({
    awardWalletOnce: jest.fn(async (_userId: string, key: string) => {
      const already = walletAwards.includes(key);
      if (!already) walletAwards.push(key);
      return { walletBalance: 0, awarded: already ? 0 : 1, alreadyAwarded: already };
    }),
  }),
}));

import { ReferralsService, REFERRAL_BONUS_AI_USES_EACH } from './referrals';
import { REFERRAL_BONUS_AI_USES } from '@lantern/shared/utils/aiCredits';
import type { DataLayer } from './data';

const REFERRAL_ID = '11111111-1111-4111-8111-111111111111';
const REFERRER = '22222222-2222-4222-8222-222222222222';
const REFEREE = '33333333-3333-4333-8333-333333333333';

/** Enough of PostgREST for `checkActivation`: one referral row, and updates. */
function makeDb(row: Record<string, unknown> | null) {
  let current = row;
  const table = (name: string): any => {
    if (name === 'referrals') {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: current, error: null }) }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: async () => {
            if (current) current = { ...current, ...patch };
            return { data: null, error: null };
          },
        }),
      };
    }
    // profiles: only ever updated here (activated_at), never read for this path.
    return {
      update: () => ({
        eq: () => ({ is: async () => ({ data: null, error: null }) }),
      }),
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    };
  };

  const client = {
    from: jest.fn(table),
    rpc: jest.fn(async (fn: string) => {
      if (fn === 'referral_activation_check') return { data: true, error: null };
      return { data: null, error: null };
    }),
  };
  return {
    service: { getClient: () => client } as unknown as DataLayer,
    readRow: () => current,
  };
}

function makeService(row: Record<string, unknown> | null) {
  const { service, readRow } = makeDb(row);
  const { getWalletService } = require('./walletService');
  return { svc: new ReferralsService(service, getWalletService()), readRow };
}

const pendingReferral = {
  id: REFERRAL_ID,
  referrer_id: REFERRER,
  referee_id: REFEREE,
  qualified_at: null,
  rewarded_at: null,
  created_at: new Date().toISOString(),
};

describe('a referral that activates', () => {
  beforeEach(() => {
    granted.length = 0;
    walletAwards.length = 0;
    bonusAvailable = true;
  });

  it('grants bonus AI uses to both sides, keyed on the referral id', async () => {
    const { svc } = makeService({ ...pendingReferral });
    const result = await svc.checkActivation(REFEREE);

    expect(result.rewarded).toBe(true);
    expect(granted).toEqual([
      { userId: REFERRER, sourceId: `referral:referrer:${REFERRAL_ID}`, amount: REFERRAL_BONUS_AI_USES },
      { userId: REFEREE, sourceId: `referral:referee:${REFERRAL_ID}`, amount: REFERRAL_BONUS_AI_USES },
    ]);
    // Both sides get the same amount, from the shared constant the screen prints.
    expect(REFERRAL_BONUS_AI_USES_EACH).toBe(REFERRAL_BONUS_AI_USES);
  });

  it('grants the AI uses at the same moment as the coins, under the same guard', async () => {
    const { svc } = makeService({ ...pendingReferral });
    await svc.checkActivation(REFEREE);

    expect(walletAwards).toEqual([
      `referral:referrer:${REFERRAL_ID}`,
      `referral:referee:${REFERRAL_ID}`,
    ]);
    expect(granted.map((g) => g.sourceId)).toEqual(walletAwards);
  });

  it('pays once, however many times activation is checked', async () => {
    const { svc, readRow } = makeService({ ...pendingReferral });
    await svc.checkActivation(REFEREE);
    await svc.checkActivation(REFEREE);
    await svc.checkActivation(REFEREE);

    // `rewarded_at` short-circuits the repeats; the unique source id would stop
    // them anyway if two calls raced past it.
    expect((readRow() as { rewarded_at: string | null }).rewarded_at).toBeTruthy();
    expect(granted).toHaveLength(2);
  });

  it('still pays the coins when the bonus ledger is not there yet', async () => {
    // The window before the migration is hand-applied. A referral that pays no
    // AI uses is a smaller failure than a referral that pays nothing at all.
    bonusAvailable = false;
    const { svc } = makeService({ ...pendingReferral });

    const result = await svc.checkActivation(REFEREE);

    expect(result.rewarded).toBe(true);
    expect(walletAwards).toHaveLength(2);
    expect(granted).toHaveLength(0);
  });
});
