/**
 * The banked bonus pool, from the API's side of the wire.
 *
 * The real arithmetic (the cap, the exactly-once grant, the guarded spend)
 * lives in the 20260907140000 migration's functions, so the fake below
 * implements those functions to their documented contract and the tests pin
 * the service's INTERPRETATION of them: that a repeated source id pays nothing,
 * that a capped grant is still recorded, that a spend is all-or-nothing, and —
 * most importantly — that an unapplied migration degrades to "you have no
 * bonus" rather than to an exception or a balance nobody has.
 */
import {
  __setAiBonusSupabaseForTests,
  getBonusBalance,
  grantBonusUses,
  isMissingBonusSchema,
  refundBonusUses,
  spendBonusUses,
} from './aiBonusUses';
import type { DataLayer } from './data';

const CAP = 50;

type PgError = { code?: string; message?: string } | null;

/** An in-memory stand-in for the migration's tables and functions. */
function makeLedger(options: { failWith?: PgError } = {}) {
  const balances = new Map<string, number>();
  const grants = new Map<string, { userId: string; amount: number; reason: string | null }>();

  const fail = () => options.failWith ?? null;

  const rpc = jest.fn(async (name: string, args: Record<string, unknown>) => {
    const error = fail();
    if (error) return { data: null, error };

    const userId = String(args.p_user_id);
    const amount = Math.max(0, Number(args.p_amount) || 0);

    if (name === 'ai_bonus_grant') {
      const sourceId = String(args.p_source_id);
      const cap = Math.max(0, Number(args.p_cap) || 0);
      const current = balances.get(userId) ?? 0;
      if (grants.has(sourceId)) {
        return {
          data: { granted: false, amount: 0, balance: current, capped: false },
          error: null,
        };
      }
      const room = Math.max(0, cap - current);
      const granted = Math.min(amount, room);
      grants.set(sourceId, {
        userId,
        amount: granted,
        reason: granted === 0 ? 'capped: banked balance at or above cap' : null,
      });
      balances.set(userId, current + granted);
      return {
        data: {
          granted: granted > 0,
          amount: granted,
          balance: current + granted,
          capped: granted < amount,
        },
        error: null,
      };
    }

    if (name === 'ai_bonus_spend') {
      const current = balances.get(userId) ?? 0;
      if (amount === 0) return { data: { spent: true, amount: 0, balance: current }, error: null };
      if (current < amount) return { data: { spent: false, amount: 0, balance: current }, error: null };
      balances.set(userId, current - amount);
      return { data: { spent: true, amount, balance: current - amount }, error: null };
    }

    if (name === 'ai_bonus_refund') {
      const next = (balances.get(userId) ?? 0) + amount;
      balances.set(userId, next);
      return { data: next, error: null };
    }

    throw new Error(`unexpected rpc ${name}`);
  });

  const from = jest.fn(() => ({
    select: () => ({
      eq: (_col: string, userId: string) => ({
        maybeSingle: async () => {
          const error = fail();
          if (error) return { data: null, error };
          const balance = balances.get(String(userId));
          return { data: balance === undefined ? null : { balance }, error: null };
        },
      }),
    }),
  }));

  const service = { getClient: () => ({ rpc, from }) } as unknown as DataLayer;
  return { service, balances, grants, rpc };
}

describe('isMissingBonusSchema', () => {
  it('recognises every shape of "the migration is not applied yet"', () => {
    for (const code of ['42P01', '42883', '42703', 'PGRST202', 'PGRST205']) {
      expect(isMissingBonusSchema({ code })).toBe(true);
    }
    expect(isMissingBonusSchema({ message: 'Could not find the function ai_bonus_spend' })).toBe(
      true
    );
  });

  it('does not mistake a real fault for an unapplied migration', () => {
    // A broken ledger that read as an empty one would silently stop paying
    // rewards and nobody would see an error.
    expect(isMissingBonusSchema({ code: '57014', message: 'statement timeout' })).toBe(false);
    expect(isMissingBonusSchema({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isMissingBonusSchema(null)).toBe(false);
  });
});

describe('the bonus ledger', () => {
  it('grants once per source id, however many times it is asked', async () => {
    const { service, balances } = makeLedger();
    __setAiBonusSupabaseForTests(service);

    const first = await grantBonusUses('u1', {
      source: 'referral',
      sourceId: 'referral:referrer:r1',
      amount: 5,
      cap: CAP,
    });
    const second = await grantBonusUses('u1', {
      source: 'referral',
      sourceId: 'referral:referrer:r1',
      amount: 5,
      cap: CAP,
    });

    expect(first.granted).toBe(true);
    expect(first.amount).toBe(5);
    expect(second.granted).toBe(false);
    expect(second.amount).toBe(0);
    expect(balances.get('u1')).toBe(5);
  });

  it('pays what fits under the banked cap, and records the rest as capped', async () => {
    const { service, grants } = makeLedger();
    __setAiBonusSupabaseForTests(service);

    for (let i = 0; i < 9; i++) {
      await grantBonusUses('u2', {
        source: 'referral',
        sourceId: `referral:referrer:cap-${i}`,
        amount: 5,
        cap: CAP,
      });
    }
    expect(await getBonusBalance('u2')).toBe(45);

    // 45 banked, cap 50: this grant pays the 5 that fit exactly.
    const fits = await grantBonusUses('u2', {
      source: 'referral',
      sourceId: 'referral:referrer:cap-fits',
      amount: 5,
      cap: CAP,
    });
    expect(fits.amount).toBe(5);
    expect(await getBonusBalance('u2')).toBe(50);

    // Full. The referral still qualified, so it is RECORDED at 0 rather than
    // dropped — the ledger must never lose a referral that earned something.
    const capped = await grantBonusUses('u2', {
      source: 'referral',
      sourceId: 'referral:referrer:cap-over',
      amount: 5,
      cap: CAP,
    });
    expect(capped.granted).toBe(false);
    expect(capped.capped).toBe(true);
    expect(await getBonusBalance('u2')).toBe(50);
    expect(grants.get('referral:referrer:cap-over')).toEqual({
      userId: 'u2',
      amount: 0,
      reason: 'capped: banked balance at or above cap',
    });
  });

  it('spends all or nothing, and refunds back into the same balance', async () => {
    const { service } = makeLedger();
    __setAiBonusSupabaseForTests(service);
    await grantBonusUses('u3', {
      source: 'referral',
      sourceId: 'referral:referee:r3',
      amount: 5,
      cap: CAP,
    });

    expect(await spendBonusUses('u3', 3)).toBe(true);
    expect(await getBonusBalance('u3')).toBe(2);

    // 3 costs more than the 2 that are left: nothing is taken, not even the 2.
    expect(await spendBonusUses('u3', 3)).toBe(false);
    expect(await getBonusBalance('u3')).toBe(2);

    await refundBonusUses('u3', 3);
    expect(await getBonusBalance('u3')).toBe(5);
  });
});

describe('before the migration is applied', () => {
  const missing = { code: 'PGRST205', message: "Could not find the table 'ai_bonus_uses'" };

  it('reads a zero balance, grants nothing, and spends nothing — without throwing', async () => {
    const { service } = makeLedger({ failWith: missing });
    __setAiBonusSupabaseForTests(service);

    expect(await getBonusBalance('u4')).toBe(0);

    const grant = await grantBonusUses('u4', {
      source: 'referral',
      sourceId: 'referral:referrer:r4',
      amount: 5,
      cap: CAP,
    });
    expect(grant).toMatchObject({ granted: false, amount: 0, unavailable: true });

    // False is the honest answer: this request cannot be paid out of bonus, so
    // the caller charges (or refuses on) the daily allowance exactly as before.
    expect(await spendBonusUses('u4', 1)).toBe(false);
    await expect(refundBonusUses('u4', 1)).resolves.toBeUndefined();
  });

  it('is equally safe when the API has no supabase wired at all', async () => {
    __setAiBonusSupabaseForTests(null);
    expect(await getBonusBalance('u5')).toBe(0);
    expect(await spendBonusUses('u5', 1)).toBe(false);
    expect(
      (await grantBonusUses('u5', { source: 'referral', sourceId: 's', amount: 5 })).granted
    ).toBe(false);
  });
});
