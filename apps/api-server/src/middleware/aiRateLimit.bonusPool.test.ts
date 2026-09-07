/**
 * Spend order, and what happens to a charge that has to be given back.
 *
 * Two pools with different physics: the DAILY allowance resets at midnight and
 * is owed to nobody; the BONUS pool is banked, earned by referral, and never
 * resets. The rules this file pins:
 *
 *   1. Daily is spent first. A student should lose the thing that expires
 *      anyway before the thing they earned.
 *   2. A charge comes out of ONE pool. All-or-nothing, so `pool` is the whole
 *      truth about where it came from.
 *   3. A refund goes back to the pool that paid. Refunding a bonus use into
 *      the daily counter would turn a use that never expires into one that
 *      dies at midnight — the student would be robbed by a failed job.
 *   4. Bonus extends the GLOBAL allowance, never a per-feature cap.
 */
const bonus = {
  balances: new Map<string, number>(),
  get(userId: string) {
    return this.balances.get(userId) ?? 0;
  },
  set(userId: string, value: number) {
    this.balances.set(userId, value);
  },
  reset() {
    this.balances.clear();
  },
};

jest.mock('../services/aiBonusUses', () => ({
  getBonusBalance: jest.fn(async (userId: string) => bonus.get(userId)),
  spendBonusUses: jest.fn(async (userId: string, amount: number) => {
    if (bonus.get(userId) < amount) return false;
    bonus.set(userId, bonus.get(userId) - amount);
    return true;
  }),
  refundBonusUses: jest.fn(async (userId: string, amount: number) => {
    bonus.set(userId, bonus.get(userId) + amount);
  }),
}));

import {
  aiRateLimit,
  aiRateLimitForFeature,
  aiRateLimitWithCost,
  chargeAiCreditsDetailed,
  getAIBonusUsage,
  refundAiCredits,
  resetAIUsageForUser,
  AI_USAGE_EXPOSED_HEADERS,
  AI_BONUS_REMAINING_HEADER,
} from './aiRateLimit';
import { DEFAULT_AI_DAILY_LIMIT } from '@lantern/shared/utils/aiUsage';
import { REFERRAL_BONUS_AI_USES_CAP } from '@lantern/shared/utils/aiCredits';

const LIMIT = DEFAULT_AI_DAILY_LIMIT;

function mockRes() {
  return {
    headers: {} as Record<string, string>,
    locals: {} as Record<string, unknown>,
    statusCode: 200,
    body: null as unknown,
    listeners: {} as Record<string, Array<() => void>>,
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
    },
    on(event: string, cb: () => void) {
      (this.listeners[event] ||= []).push(cb);
      return this;
    },
    async finish() {
      for (const cb of this.listeners.finish || []) cb();
      // Refunds are fire-and-forget inside the hook; let them settle.
      await new Promise((resolve) => setTimeout(resolve, 20));
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

/** Run a middleware to whichever comes first: next() (allowed) or json() (429). */
function run(
  middleware: (req: any, res: any, next: () => void) => unknown,
  res: ReturnType<typeof mockRes>,
  req: any
): Promise<void> {
  return new Promise<void>((resolve) => {
    const sendJson = res.json.bind(res);
    res.json = ((payload: unknown) => {
      const out = sendJson(payload);
      resolve();
      return out;
    }) as typeof res.json;
    void Promise.resolve(middleware(req, res, () => resolve()));
  });
}

/** Burn the whole daily allowance so the next charge must reach for bonus. */
async function exhaustDaily(userId: string): Promise<void> {
  for (let i = 0; i < LIMIT; i++) {
    const res = mockRes();
    await run(aiRateLimit, res, { user: { id: userId } });
    expect(res.statusCode).toBe(200);
  }
}

describe('spend order', () => {
  const userId = 'bonus-order-user';

  beforeEach(async () => {
    bonus.reset();
    await resetAIUsageForUser(userId);
  });

  it('spends the daily allowance first while any of it is left', async () => {
    bonus.set(userId, 5);
    const res = mockRes();
    await run(aiRateLimit, res, { user: { id: userId } });

    expect(res.statusCode).toBe(200);
    expect(res.locals.aiCharge).toEqual({ credits: 1, pool: 'daily' });
    // Untouched: the banked pool is the last thing spent, not the first.
    expect(bonus.get(userId)).toBe(5);
    expect(res.headers[AI_BONUS_REMAINING_HEADER.toLowerCase()]).toBe('5');
  });

  it('draws on the bonus pool only once the day is gone', async () => {
    bonus.set(userId, 2);
    await exhaustDaily(userId);
    expect(bonus.get(userId)).toBe(2);

    const res = mockRes();
    await run(aiRateLimit, res, { user: { id: userId } });

    expect(res.statusCode).toBe(200);
    expect(res.locals.aiCharge).toEqual({ credits: 1, pool: 'bonus' });
    expect(bonus.get(userId)).toBe(1);
    expect(res.headers[AI_BONUS_REMAINING_HEADER.toLowerCase()]).toBe('1');
  });

  it('refuses, and takes nothing, when neither pool can pay', async () => {
    bonus.set(userId, 0);
    await exhaustDaily(userId);

    const res = mockRes();
    await run(aiRateLimit, res, { user: { id: userId } });

    expect(res.statusCode).toBe(429);
    expect(bonus.get(userId)).toBe(0);
    expect(res.headers[AI_BONUS_REMAINING_HEADER.toLowerCase()]).toBe('0');
  });

  it('pays a multi-use action entirely from bonus rather than splitting pools', async () => {
    // 19 of 20 daily spent, so 1 daily is left and the action costs 3. A split
    // charge would make `pool` a half-truth and the refund approximate, so the
    // whole 3 comes out of bonus.
    for (let i = 0; i < LIMIT - 1; i++) {
      const res = mockRes();
      await run(aiRateLimit, res, { user: { id: userId } });
    }
    bonus.set(userId, 4);

    const res = mockRes();
    await run(
      aiRateLimitWithCost(() => 3, { label: 'Deep dive Smart Notes' }),
      res,
      { user: { id: userId }, body: {} }
    );

    expect(res.statusCode).toBe(200);
    expect(res.locals.aiCharge).toEqual({ credits: 3, pool: 'bonus' });
    expect(bonus.get(userId)).toBe(1);
    expect(res.headers['x-ai-cost']).toBe('3');
  });

  it('quotes what the student can actually spend when it refuses, bonus included', async () => {
    await exhaustDaily(userId);
    bonus.set(userId, 2);

    const res = mockRes();
    await run(aiRateLimitWithCost(() => 3, { label: 'Deep dive Smart Notes' }), res, {
      user: { id: userId },
      body: {},
    });

    expect(res.statusCode).toBe(429);
    expect(res.body).toMatchObject({ remaining: 2, bonusRemaining: 2, cost: 3 });
    expect(bonus.get(userId)).toBe(2);
  });
});

describe('refunds go back to the pool that paid', () => {
  const userId = 'bonus-refund-user';

  beforeEach(async () => {
    bonus.reset();
    await resetAIUsageForUser(userId);
  });

  it('returns a failed bonus charge to the bonus balance, not to the daily counter', async () => {
    await exhaustDaily(userId);
    bonus.set(userId, 3);

    const res = mockRes();
    await run(aiRateLimitWithCost(() => 2, { label: 'Deep dive Smart Notes' }), res, {
      user: { id: userId },
      body: {},
    });
    expect(bonus.get(userId)).toBe(1);

    res.statusCode = 500;
    await res.finish();

    expect(bonus.get(userId)).toBe(3);
    // The daily counter was already full and must stay full: crediting it here
    // would hand out free daily uses on every provider failure.
    const { bonusRemaining } = await getAIBonusUsage(userId);
    expect(bonusRemaining).toBe(3);
  });

  it('returns a failed daily charge to the daily counter, not to the bonus balance', async () => {
    bonus.set(userId, 3);

    const res = mockRes();
    await run(aiRateLimitWithCost(() => 2, { label: 'Deep dive Smart Notes' }), res, {
      user: { id: userId },
      body: {},
    });
    res.statusCode = 500;
    await res.finish();

    // Unchanged. A daily refund that landed in the bonus pool would quietly
    // mint banked uses out of failed requests.
    expect(bonus.get(userId)).toBe(3);
  });

  it('honours an explicit pool on a manual refund', async () => {
    bonus.set(userId, 0);
    await exhaustDaily(userId);

    await refundAiCredits(userId, 2, 'bonus');
    expect(bonus.get(userId)).toBe(2);

    await refundAiCredits(userId, 2);
    expect(bonus.get(userId)).toBe(2);
  });
});

describe('bonus and the per-feature caps', () => {
  const userId = 'bonus-feature-user';

  beforeEach(async () => {
    bonus.reset();
    await resetAIUsageForUser(userId);
  });

  it('lets bonus cover the global charge behind a feature route', async () => {
    await exhaustDaily(userId);
    bonus.set(userId, 1);

    const res = mockRes();
    await run(aiRateLimitForFeature('explain'), res, { user: { id: userId } });

    expect(res.statusCode).toBe(200);
    expect(res.locals.aiCharge).toMatchObject({ featureKey: 'explain', pool: 'bonus' });
    expect(bonus.get(userId)).toBe(0);
  });

  it('does not let bonus buy past a spent per-feature cap', async () => {
    // The feature cap is a fairness rule about how much of one tool you may run
    // in a day. An earned reward is not a reason to run 30 study plans.
    const featureLimit = 10; // DEFAULT_AI_FEATURE_LIMITS.study_plan
    for (let i = 0; i < featureLimit; i++) {
      const res = mockRes();
      await run(aiRateLimitForFeature('study_plan'), res, { user: { id: userId } });
      expect(res.statusCode).toBe(200);
    }
    bonus.set(userId, 20);

    const res = mockRes();
    await run(aiRateLimitForFeature('study_plan'), res, { user: { id: userId } });

    expect(res.statusCode).toBe(429);
    expect(res.body).toMatchObject({ feature: 'study_plan' });
    expect(bonus.get(userId)).toBe(20);
  });
});

describe('what the API reports about the pool', () => {
  const userId = 'bonus-report-user';

  beforeEach(async () => {
    bonus.reset();
    await resetAIUsageForUser(userId);
  });

  it('reports the banked balance and the cap it is banked against', async () => {
    bonus.set(userId, 7);
    expect(await getAIBonusUsage(userId)).toEqual({
      bonusRemaining: 7,
      bonusCap: REFERRAL_BONUS_AI_USES_CAP,
    });
  });

  it('exposes the bonus header through CORS, or the browser cannot read it', () => {
    expect(AI_USAGE_EXPOSED_HEADERS).toContain(AI_BONUS_REMAINING_HEADER);
  });

  it('says which pool a direct charge came out of', async () => {
    bonus.set(userId, 5);
    const fromDaily = await chargeAiCreditsDetailed(userId, 2, 'OCR');
    expect(fromDaily).toEqual({ ok: true, pool: 'daily', credits: 2 });

    await resetAIUsageForUser(userId);
    await exhaustDaily(userId);
    const fromBonus = await chargeAiCreditsDetailed(userId, 2, 'OCR');
    expect(fromBonus).toEqual({ ok: true, pool: 'bonus', credits: 2 });
    expect(bonus.get(userId)).toBe(3);
  });
});

describe('a refusal names the two pools separately', () => {
  const userId = 'two-pool-refusal-user';

  beforeEach(async () => {
    bonus.reset();
    await resetAIUsageForUser(userId);
  });

  it('never quotes a summed figure the student cannot spend on this request', async () => {
    // 2 left today, 2 banked, a 3-use action: neither pool can pay, and a
    // sentence saying "you have 4 left" would claim they can.
    const charged = await chargeAiCreditsDetailed(userId, LIMIT - 2);
    expect(charged.ok).toBe(true);
    bonus.set(userId, 2);

    const res = mockRes();
    await run(aiRateLimitWithCost(() => 3, { label: 'Transcribing this recording' }), res, {
      user: { id: userId },
      body: {},
    });

    expect(res.statusCode).toBe(429);
    const body = res.body as { error: string; remaining: number; bonusRemaining: number };
    expect(body.error).toContain('needs 3 AI uses');
    expect(body.error).toContain('2 left today and 2 banked');
    expect(body.error).not.toContain('4 left');
    // The total is still reported as data for a client that wants to show it.
    expect(body).toMatchObject({ remaining: 4, bonusRemaining: 2 });
    // Nothing moved in either pool.
    expect(bonus.get(userId)).toBe(2);
  });

  it('leaves the banked half out of the sentence when there is none', async () => {
    await chargeAiCreditsDetailed(userId, LIMIT - 1);

    const res = mockRes();
    await run(aiRateLimitWithCost(() => 3, { label: 'Deep dive Smart Notes' }), res, {
      user: { id: userId },
      body: {},
    });

    expect(res.statusCode).toBe(429);
    const body = res.body as { error: string };
    expect(body.error).toContain('1 left today');
    expect(body.error).not.toContain('banked');
  });
});
