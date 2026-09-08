/**
 * The referral reward self-heals its AI-use half forward.
 *
 * A referral pays in two currencies. Coins are guarded by `wallet_award_once`;
 * bonus AI uses by the UNIQUE `ai_bonus_grants.source_id`. Both keys are derived
 * from the referral row id, so the two guards agree. Every pair rewarded before
 * the 20260907140000 migration existed got its coins and no AI uses, and the old
 * code returned early the moment `rewarded_at` was set — so the AI grant could
 * never retry. These tests pin the fix:
 *
 *   - a pair whose grant is missing gets it on the next check;
 *   - a pair whose grant exists is not double-granted;
 *   - a failing grant leaves the coin half intact.
 */

/** Simulates the DB unique guard on `ai_bonus_grants.source_id`. */
const granted: Array<{ userId: string; sourceId: string; amount: number }> = [];
/** 'ok' pays, 'unavailable' is the pre-migration window, 'throw' is a hard fault. */
let grantMode: 'ok' | 'unavailable' | 'throw' = 'ok';

jest.mock('./aiBonusUses', () => ({
  grantBonusUses: jest.fn(
    async (
      userId: string,
      params: { sourceId: string; amount: number; cap?: number }
    ) => {
      if (grantMode === 'throw') throw new Error('ledger exploded');
      if (grantMode === 'unavailable') {
        return { granted: false, amount: 0, balance: 0, capped: false, unavailable: true };
      }
      // The UNIQUE source id: a second grant for the same key records nothing.
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

import { ReferralsService } from './referrals';
import { REFERRAL_BONUS_AI_USES } from '@lantern/shared/utils/aiCredits';
import type { SupabaseService } from './supabase';

const REFERRAL_ID = '11111111-1111-4111-8111-111111111111';
const REFERRER = '22222222-2222-4222-8222-222222222222';
const REFEREE = '33333333-3333-4333-8333-333333333333';
const REFERRER_KEY = `referral:referrer:${REFERRAL_ID}`;
const REFEREE_KEY = `referral:referee:${REFERRAL_ID}`;

/** Just enough of PostgREST for `checkActivation`: one referral row + updates. */
function makeDb(row: Record<string, unknown> | null, activated = true) {
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
    // profiles: only ever updated here (activated_at) on this path.
    return {
      update: () => ({ eq: () => ({ is: async () => ({ data: null, error: null }) }) }),
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    };
  };
  const client = {
    from: jest.fn(table),
    rpc: jest.fn(async (fn: string) => {
      if (fn === 'referral_activation_check') return { data: activated, error: null };
      return { data: null, error: null };
    }),
  };
  return { service: { getClient: () => client } as unknown as SupabaseService, readRow: () => current };
}

function makeService(row: Record<string, unknown> | null, activated = true) {
  const { service, readRow } = makeDb(row, activated);
  const { getWalletService } = require('./walletService');
  return { svc: new ReferralsService(service, getWalletService()), readRow };
}

const now = () => new Date().toISOString();

const pendingReferral = () => ({
  id: REFERRAL_ID,
  referrer_id: REFERRER,
  referee_id: REFEREE,
  qualified_at: null as string | null,
  rewarded_at: null as string | null,
  created_at: now(),
});

/** A pair already paid in coins (rewarded_at set), recently, within the window. */
const rewardedReferral = () => ({
  ...pendingReferral(),
  qualified_at: now(),
  rewarded_at: now(),
  reward_amount: 200,
});

beforeEach(() => {
  granted.length = 0;
  walletAwards.length = 0;
  grantMode = 'ok';
});

describe('self-healing the AI-use half of a rewarded referral', () => {
  it('grants the missing bonus uses on the next check for a pair rewarded before the ledger existed', async () => {
    // rewarded_at is set (coins were paid pre-migration) but no grant exists.
    const { svc, readRow } = makeService(rewardedReferral());

    const result = await svc.checkActivation(REFEREE);

    // No NEW coin reward is claimed — the coins were already paid.
    expect(result.rewarded).toBe(false);
    // ...but the AI-use half is healed forward, keyed on the referral id.
    expect(granted).toEqual([
      { userId: REFERRER, sourceId: REFERRER_KEY, amount: REFERRAL_BONUS_AI_USES },
      { userId: REFEREE, sourceId: REFEREE_KEY, amount: REFERRAL_BONUS_AI_USES },
    ]);
    // The heal never touches the coin half.
    expect(walletAwards).toHaveLength(0);
    // rewarded_at is left as it was.
    expect((readRow() as { rewarded_at: string | null }).rewarded_at).toBeTruthy();
  });

  it('does not double-grant a pair whose AI-use grant already exists', async () => {
    // Both grants are already on the ledger.
    granted.push({ userId: REFERRER, sourceId: REFERRER_KEY, amount: REFERRAL_BONUS_AI_USES });
    granted.push({ userId: REFEREE, sourceId: REFEREE_KEY, amount: REFERRAL_BONUS_AI_USES });
    const { svc } = makeService(rewardedReferral());

    const result = await svc.checkActivation(REFEREE);

    expect(result.rewarded).toBe(false);
    // Still exactly two ledger rows: the re-attempt is a no-op via the unique
    // source id. A regression that keyed the grant on anything but the referral
    // id (a timestamp, say) would push new rows here.
    expect(granted).toHaveLength(2);
    expect(walletAwards).toHaveLength(0);
  });

  it('stops chasing pairs older than the qualify window', async () => {
    // A very old rewarded pair with no grant: past the window, do not keep
    // firing grant RPCs on every hourly check. That debt is the founder's call.
    const old = {
      ...rewardedReferral(),
      created_at: new Date(Date.now() - 200 * 86_400_000).toISOString(),
    };
    const { svc } = makeService(old);

    const result = await svc.checkActivation(REFEREE);

    expect(result.rewarded).toBe(false);
    expect(granted).toHaveLength(0);
  });
});

describe('a referral activating for the first time', () => {
  it('pays coins and the AI-use half together', async () => {
    const { svc, readRow } = makeService(pendingReferral());

    const result = await svc.checkActivation(REFEREE);

    expect(result.rewarded).toBe(true);
    expect(walletAwards).toEqual([REFERRER_KEY, REFEREE_KEY]);
    expect(granted.map((g) => g.sourceId)).toEqual([REFERRER_KEY, REFEREE_KEY]);
    expect((readRow() as { rewarded_at: string | null }).rewarded_at).toBeTruthy();
  });

  it('leaves the coin half intact when the AI grant throws', async () => {
    // The AI-use half must never fail or reverse the coins. Even a hard throw
    // from the grant leaves the coins paid and the pair stamped.
    grantMode = 'throw';
    const { svc, readRow } = makeService(pendingReferral());

    const result = await svc.checkActivation(REFEREE);

    expect(result.rewarded).toBe(true);
    expect(walletAwards).toEqual([REFERRER_KEY, REFEREE_KEY]);
    expect(granted).toHaveLength(0);
    expect((readRow() as { rewarded_at: string | null }).rewarded_at).toBeTruthy();
  });

  it('still pays the coins when the bonus ledger is not there yet', async () => {
    // The window before the migration is hand-applied: coins pay, AI grants
    // nothing, and rewarded_at is stamped so the self-heal can finish later.
    grantMode = 'unavailable';
    const { svc, readRow } = makeService(pendingReferral());

    const result = await svc.checkActivation(REFEREE);

    expect(result.rewarded).toBe(true);
    expect(walletAwards).toHaveLength(2);
    expect(granted).toHaveLength(0);
    expect((readRow() as { rewarded_at: string | null }).rewarded_at).toBeTruthy();
  });

  it('pays once, however many times activation is checked, then only heals', async () => {
    const { svc, readRow } = makeService(pendingReferral());
    await svc.checkActivation(REFEREE);
    await svc.checkActivation(REFEREE);
    await svc.checkActivation(REFEREE);

    // Coins once, AI uses once; the repeats fall into the heal branch and no-op.
    expect(walletAwards).toEqual([REFERRER_KEY, REFEREE_KEY]);
    expect(granted).toHaveLength(2);
    expect((readRow() as { rewarded_at: string | null }).rewarded_at).toBeTruthy();
  });
});
