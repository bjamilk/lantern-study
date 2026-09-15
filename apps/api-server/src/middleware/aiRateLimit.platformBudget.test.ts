/**
 * F10. Every limit in this module is per user and per feature, so the provider
 * bill scaled linearly with the number of accounts — and sign-up is free and
 * unverified. The NUMBER is a founder cost decision, so it is deliberately
 * unset; what F10 built is the mechanism behind it, so turning the cap on is
 * one environment variable.
 *
 * These pin the two things that matter about a mechanism nobody has switched on
 * yet: that it is genuinely inert while unset, and that it does the right thing
 * the moment a number is given — including giving the budget back when the
 * request it was reserved for never ran.
 */
const store = new Map<string, number>();
let redisOpen = true;

const fakeRedis = {
  get isOpen() {
    return redisOpen;
  },
  async incrBy(key: string, by: number) {
    const next = (store.get(key) ?? 0) + by;
    store.set(key, next);
    return next;
  },
  async ttl() {
    return 100;
  },
  async expire() {
    return true;
  },
};

jest.mock('../services/redisStore', () => ({
  redisKey: (suffix: string) => `test:${suffix}`,
  getRedisClient: async () => (redisOpen ? fakeRedis : null),
}));

jest.mock('../services/aiBonusUses', () => ({
  getBonusBalance: jest.fn(async () => 0),
  spendBonusUses: jest.fn(async () => false),
  refundBonusUses: jest.fn(async () => undefined),
}));

const logged: Array<{ level: string; message: string }> = [];
jest.mock('../utils/logger', () => ({
  logger: {
    debug: (message: string) => logged.push({ level: 'debug', message }),
    info: (message: string) => logged.push({ level: 'info', message }),
    warn: (message: string) => logged.push({ level: 'warn', message }),
    error: (message: string) => logged.push({ level: 'error', message }),
  },
}));

import { aiRateLimit, refundAiCredits } from './aiRateLimit';

function fakeRes() {
  const res: any = { statusCode: 200, body: undefined, headers: {} as Record<string, string> };
  res.setHeader = (name: string, value: string) => {
    res.headers[name.toLowerCase()] = String(value);
    return res;
  };
  res.status = (code: number) => ((res.statusCode = code), res);
  res.json = (body: unknown) => ((res.body = body), res);
  res.on = () => res;
  res.locals = {};
  return res;
}

async function charge(userId: string) {
  const res = fakeRes();
  let allowed = false;
  await aiRateLimit({ user: { id: userId } } as any, res, () => {
    allowed = true;
  });
  return { res, allowed };
}

const originalEnv = process.env.NODE_ENV;

beforeEach(() => {
  store.clear();
  logged.length = 0;
  redisOpen = true;
  delete process.env.AI_DAILY_BUDGET_CREDITS;
});

afterEach(() => {
  process.env.NODE_ENV = originalEnv;
  delete process.env.AI_DAILY_BUDGET_CREDITS;
});

describe('the platform-wide AI budget', () => {
  it('is inert while AI_DAILY_BUDGET_CREDITS is unset — the counter is never even touched', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await charge(`user-${i}`)).allowed).toBe(true);
    }
    expect([...store.keys()].some((key) => key.includes('__platform__'))).toBe(false);
  });

  it('ignores a nonsense value rather than capping at zero', async () => {
    process.env.AI_DAILY_BUDGET_CREDITS = 'lots';
    expect((await charge('user-a')).allowed).toBe(true);
    process.env.AI_DAILY_BUDGET_CREDITS = '0';
    expect((await charge('user-b')).allowed).toBe(true);
  });

  it('spends the budget across DIFFERENT users and then answers 503, not 429', async () => {
    process.env.AI_DAILY_BUDGET_CREDITS = '2';
    expect((await charge('user-a')).allowed).toBe(true);
    expect((await charge('user-b')).allowed).toBe(true);

    const third = await charge('user-c');
    expect(third.allowed).toBe(false);
    // 429 would tell user-c they had used up THEIR allowance, which is a lie
    // they cannot act on — they have spent one credit all day.
    expect(third.res.statusCode).toBe(503);
    expect(third.res.body).toMatchObject({ code: 'AI_BUDGET_EXHAUSTED' });
    expect(third.res.body.resetsAt).toEqual(expect.any(String));
    expect(logged.some((entry) => entry.level === 'error' && /budget exhausted/i.test(entry.message))).toBe(
      true
    );
  });

  it('charges the student nothing when the platform refuses', async () => {
    process.env.AI_DAILY_BUDGET_CREDITS = '1';
    await charge('user-a');
    const before = store.get('test:ai:' + new Date().toISOString().slice(0, 10) + ':user-b') ?? 0;
    await charge('user-b');
    const after = store.get('test:ai:' + new Date().toISOString().slice(0, 10) + ':user-b') ?? 0;
    expect(after).toBe(before);
  });

  it('gives the budget back when the work is refunded', async () => {
    process.env.AI_DAILY_BUDGET_CREDITS = '1';
    expect((await charge('user-a')).allowed).toBe(true);
    expect((await charge('user-b')).allowed).toBe(false);

    await refundAiCredits('user-a', 1, 'daily');
    expect((await charge('user-b')).allowed).toBe(true);
  });
});

describe('losing Redis at runtime', () => {
  it('fails closed in production instead of multiplying the cap per replica', async () => {
    process.env.NODE_ENV = 'production';
    redisOpen = false;
    const { res, allowed } = await charge('user-a');
    expect(allowed).toBe(false);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ code: 'AI_LIMITER_UNAVAILABLE' });
    expect(
      logged.some((entry) => entry.level === 'error' && /DEGRADED/.test(entry.message))
    ).toBe(true);
  });

  it('still uses the in-process counter outside production, where that is the dev store', async () => {
    process.env.NODE_ENV = 'test';
    redisOpen = false;
    expect((await charge('user-a')).allowed).toBe(true);
  });
});
