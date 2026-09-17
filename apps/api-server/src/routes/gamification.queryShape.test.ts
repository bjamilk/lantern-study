/**
 * Query shapes AND responses for the database access made directly by
 * `routes/gamification.ts` (lane R2, PR 2a).
 *
 * `routes/gamification.ts` built eight PostgREST chains inline across seven
 * `dataLayer.getClient()` escapes — `ensureDailyQuests` holds two — and had NO
 * test suite. Lane R2 moves those into `services/data/gamification.ts`.
 *
 * Written and committed against the UNTOUCHED route, so it freezes what the
 * route did rather than describing what the extraction produced. After the move
 * the same cases run through the real data module, so both halves stay under it.
 *
 * Because there was no suite, this pins TWO things per handler, not one:
 *   - the query trace (table, columns, filters, modifiers, in order), and
 *   - what the client actually sees: status and body, on the happy path and on
 *     the refusal / not-found path where the handler has one.
 * A trace-only freeze would let a rewrite keep every query and still change the
 * response, which is the half a student would notice.
 *
 * Three expectations are not cosmetic:
 *   - the streak reads and the freeze update filter `eq("user_id", …)`. The API
 *     runs as the SERVICE ROLE, which bypasses RLS, so that predicate IS the
 *     access control; without it one student spends another's freezes.
 *   - `ensureDailyQuests` upserts with `ignoreDuplicates: true` on the composite
 *     `user_id,quest_date,quest_type`, and the caller tolerates a `23505` on top
 *     of that. Both are the race between two tabs opening the quest rail at once.
 *   - `POST /quests/progress` updates `eq("id", quest.id)` with NO owner filter.
 *     That is safe ONLY because `quest.id` comes from the owner-scoped read three
 *     lines above, and it is listed as an unscoped write in the pull request.
 *     It is frozen here exactly as it is: this lane moves queries, it does not
 *     harden them.
 */
jest.mock('../middleware/auth', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../services/walletService', () => ({
  WalletInsufficientError: class extends Error {
    balance = 0;
  },
  getWalletService: () => walletStub,
}));

jest.mock('../services/idempotency', () => ({
  normalizeIdempotencyKey: () => null,
  withIdempotency: (
    _client: unknown,
    _userId: string,
    _op: string,
    _key: string,
    fn: () => Promise<unknown>,
  ) => fn(),
}));

import router, { initializeGamificationRoutes } from './gamification';
import * as gamificationData from '../services/data/gamification';

let walletStub: Record<string, jest.Mock>;

type Call = string;
type Result = { data: unknown; error: unknown };

const CHAIN_METHODS = [
  'select',
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'is',
  'in',
  'order',
  'limit',
  'update',
  'delete',
  'upsert',
  'insert',
  'maybeSingle',
  'single',
] as const;

/**
 * A PostgREST double that records the chain instead of running it. `resolve` is
 * given the table and the number of chains already seen, so a test can feed the
 * second read of the same table a different row.
 */
function recorder(resolve: Result | ((table: string, nth: number) => Result) = { data: null, error: null }) {
  const trace: Call[] = [];
  const fmt = (args: unknown[]) => args.map((a) => JSON.stringify(a)).join(', ');
  const resultFor = typeof resolve === 'function' ? resolve : () => resolve;
  let nth = 0;

  const client = {
    from: (table: string) => {
      trace.push(`from(${JSON.stringify(table)})`);
      const mine = nth++;
      const builder: any = {
        then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
          Promise.resolve(resultFor(table, mine)).then(ok, err),
      };
      for (const method of CHAIN_METHODS) {
        builder[method] = (...args: unknown[]) => {
          trace.push(`${method}(${fmt(args)})`);
          return builder;
        };
      }
      return builder;
    },
  };
  return { client, trace };
}

const USER = 'user-1';

/** Only the chains, with the per-chain calls dropped — for ordering assertions. */
const tablesIn = (trace: Call[]) => trace.filter((c) => c.startsWith('from('));

async function runRoute(
  method: 'get' | 'post',
  path: string,
  req: Record<string, unknown>,
) {
  const layer = (router as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method],
  );
  if (!layer) throw new Error(`route ${method.toUpperCase()} ${path} not found`);
  const handlers = layer.route.stack.map((s: any) => s.handle);
  const handler = handlers[handlers.length - 1] as (req: any, res: any, next: any) => void;

  const res: any = { statusCode: 200, body: undefined };
  await new Promise<void>((resolve, reject) => {
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (body: unknown) => {
      res.body = body;
      resolve();
      return res;
    };
    handler(
      {
        user: { id: USER },
        params: {},
        query: {},
        body: {},
        headers: {},
        runIdempotent: (fn: () => Promise<unknown>) => fn(),
        ...req,
      },
      res,
      reject,
    );
    setTimeout(() => reject(new Error('route never responded')), 2000).unref?.();
  });
  return res;
}

/**
 * Init the family with a `gamification` namespace bound to the recording
 * client, exactly the way `data/index.ts` binds it to the real one: the route
 * calls `dataLayer.gamification.<fn>(…)`, the REAL data module builds the chain,
 * the recorder captures it. So the trace is still the query the database would
 * see, end to end, and a change in either half shows up here.
 *
 * `overrides` supplies the handful of gamification methods the route used
 * BEFORE this lane (`awardPoints`, `recomputeUserStreak`, …), which are not
 * queries this test is freezing.
 */
function initWith(
  result?: Result | ((table: string, nth: number) => Result),
  overrides: Record<string, unknown> = {},
) {
  const rec = recorder(result);
  const bound = Object.fromEntries(
    Object.entries(gamificationData)
      .filter(([, fn]) => typeof fn === 'function')
      .map(([name, fn]) => [name, (...args: unknown[]) => (fn as any)(rec.client, ...args)]),
  );
  initializeGamificationRoutes(
    { getClient: () => rec.client, gamification: { ...bound, ...overrides } } as any,
    { get: jest.fn(async () => null), set: jest.fn(async () => {}), delete: jest.fn(async () => {}) } as any,
  );
  return rec;
}

beforeEach(() => {
  walletStub = {
    adjustWallet: jest.fn(async () => ({ walletBalance: 120 })),
    getWalletBalance: jest.fn(async () => 120),
    awardWalletOnce: jest.fn(async () => ({ awarded: 0, walletBalance: 120, alreadyAwarded: true })),
  };
});

describe('POST /streak/freeze', () => {
  const withFreezes = (n: number) => ({
    data: { user_id: USER, streak_freezes: n, current_streak: 4, longest_streak: 9 },
    error: null,
  });

  it('reads the caller streak, then decrements it by one', async () => {
    const rec = initWith((_t, nth) =>
      nth === 0 ? withFreezes(2) : { data: { streak_freezes: 1 }, error: null },
    );

    const res = await runRoute('post', '/streak/freeze', {});

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, data: { streak_freezes: 1 } });

    expect(rec.trace.slice(0, 5)).toEqual([
      'from("user_streaks")',
      'select("*")',
      `eq("user_id", "${USER}")`,
      'maybeSingle()',
      'from("user_streaks")',
    ]);
    // The update: one fewer freeze, today's login date, scoped to the caller.
    const update = JSON.parse(rec.trace[5].slice('update('.length, -1));
    expect(update.streak_freezes).toBe(1);
    expect(update.last_login_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(rec.trace.slice(6)).toEqual([
      `eq("user_id", "${USER}")`,
      'select()',
      'single()',
    ]);
  });

  it('refuses with 400 and writes NOTHING when the caller has no freezes', async () => {
    const rec = initWith(withFreezes(0));

    const res = await runRoute('post', '/streak/freeze', {});

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'No streak freezes available' });
    expect(tablesIn(rec.trace)).toEqual(['from("user_streaks")']);
  });

  it('refuses with 400 when the caller has no streak row at all', async () => {
    const rec = initWith({ data: null, error: null });

    const res = await runRoute('post', '/streak/freeze', {});

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'No streak freezes available' });
    expect(tablesIn(rec.trace)).toEqual(['from("user_streaks")']);
  });
});

describe('POST /streak/freeze/purchase', () => {
  it('debits the wallet, reads the streak, then upserts one more freeze', async () => {
    const rec = initWith((_t, nth) =>
      nth === 0
        ? { data: { current_streak: 3, longest_streak: 8, last_login_date: '2026-09-01', streak_freezes: 1 }, error: null }
        : { data: { streak_freezes: 2 }, error: null },
    );

    const res = await runRoute('post', '/streak/freeze/purchase', {});

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { streak_freezes: 2, cost: 50, walletBalance: 120 },
    });
    // The debit happens BEFORE either query, and exactly once.
    expect(walletStub.adjustWallet).toHaveBeenCalledTimes(1);
    expect(walletStub.adjustWallet).toHaveBeenCalledWith(USER, -50, 'streak_freeze');

    expect(rec.trace.slice(0, 5)).toEqual([
      'from("user_streaks")',
      'select("*")',
      `eq("user_id", "${USER}")`,
      'maybeSingle()',
      'from("user_streaks")',
    ]);
    const upserted = JSON.parse(rec.trace[5].slice('upsert('.length, -', {"onConflict":"user_id"})'.length));
    expect(upserted).toMatchObject({
      user_id: USER,
      current_streak: 3,
      longest_streak: 8,
      last_login_date: '2026-09-01',
      streak_freezes: 2,
    });
    expect(rec.trace[5].endsWith(', {"onConflict":"user_id"})')).toBe(true);
    expect(rec.trace.slice(6)).toEqual(['select()', 'single()']);
  });

  it('refunds the debit when the streak read fails, and does not upsert', async () => {
    const rec = initWith({ data: null, error: { code: '42P01', message: 'no table' } });

    await expect(runRoute('post', '/streak/freeze/purchase', {})).rejects.toBeTruthy();

    expect(walletStub.adjustWallet).toHaveBeenNthCalledWith(1, USER, -50, 'streak_freeze');
    expect(walletStub.adjustWallet).toHaveBeenNthCalledWith(2, USER, 50, 'streak_freeze_refund');
    expect(tablesIn(rec.trace)).toEqual(['from("user_streaks")']);
  });

  it('answers 400 with the balance when the wallet cannot pay, before any query', async () => {
    const { WalletInsufficientError } = jest.requireMock('../services/walletService');
    const poor = new WalletInsufficientError('nope');
    poor.balance = 7;
    walletStub.adjustWallet.mockRejectedValueOnce(poor);
    const rec = initWith();

    const res = await runRoute('post', '/streak/freeze/purchase', {});

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      error: 'You need 50 wallet coins to buy a streak freeze.',
      walletBalance: 7,
    });
    expect(tablesIn(rec.trace)).toEqual([]);
  });
});

describe('GET /quests/daily', () => {
  it('seeds the four templates ignoring duplicates, then reads the day back', async () => {
    const quests = [{ id: 'q1', quest_type: 'review_cards', progress_count: 0, target_count: 10 }];
    const rec = initWith((_t, nth) => (nth === 0 ? { data: null, error: null } : { data: quests, error: null }));

    const res = await runRoute('get', '/quests/daily', { query: { activityDate: '2026-09-17' } });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, data: quests });

    expect(rec.trace[0]).toBe('from("daily_quests")');
    const seeded = JSON.parse(
      rec.trace[1].slice('upsert('.length, -', {"onConflict":"user_id,quest_date,quest_type","ignoreDuplicates":true})'.length),
    );
    expect(seeded).toEqual([
      { quest_type: 'review_cards', target_count: 10, reward_xp: 15, user_id: USER, quest_date: '2026-09-17' },
      { quest_type: 'answer_questions', target_count: 3, reward_xp: 20, user_id: USER, quest_date: '2026-09-17' },
      { quest_type: 'create_note', target_count: 1, reward_xp: 10, user_id: USER, quest_date: '2026-09-17' },
      { quest_type: 'complete_test', target_count: 1, reward_xp: 25, user_id: USER, quest_date: '2026-09-17' },
    ]);
    expect(
      rec.trace[1].endsWith(', {"onConflict":"user_id,quest_date,quest_type","ignoreDuplicates":true})'),
    ).toBe(true);
    expect(rec.trace.slice(2)).toEqual([
      'from("daily_quests")',
      'select("*")',
      `eq("user_id", "${USER}")`,
      'eq("quest_date", "2026-09-17")',
    ]);
  });

  it('tolerates a 23505 from the seed — two tabs opening the rail at once', async () => {
    const rec = initWith((_t, nth) =>
      nth === 0
        ? { data: null, error: { code: '23505', message: 'duplicate key' } }
        : { data: [], error: null },
    );

    const res = await runRoute('get', '/quests/daily', { query: { activityDate: '2026-09-17' } });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
    expect(tablesIn(rec.trace)).toHaveLength(2);
  });
});

describe('POST /quests/progress', () => {
  const quest = {
    id: 'quest-9',
    quest_type: 'review_cards',
    progress_count: 8,
    target_count: 10,
    completed: false,
    reward_xp: 15,
  };

  /** nth 0 = seed upsert, 1 = seed read, 2 = the quest read, 3 = the update. */
  const questFlow = (updated: unknown) => (_t: string, nth: number) => {
    if (nth === 2) return { data: quest, error: null };
    if (nth === 3) return { data: updated, error: null };
    return { data: [], error: null };
  };

  it('reads the quest scoped to the caller, then updates it BY ID ALONE', async () => {
    const updated = { ...quest, progress_count: 10, completed: true };
    const rec = initWith(questFlow(updated), { awardPoints: jest.fn(async () => ({})) });

    const res = await runRoute('post', '/quests/progress', {
      body: { questType: 'review_cards', increment: 2, activityDate: '2026-09-17' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, data: updated });

    // chains 2 and 3 — the seed pair is asserted by the /quests/daily cases.
    expect(rec.trace.slice(6)).toEqual([
      'from("daily_quests")',
      'select("*")',
      `eq("user_id", "${USER}")`,
      'eq("quest_date", "2026-09-17")',
      'eq("quest_type", "review_cards")',
      'maybeSingle()',
      'from("daily_quests")',
      'update({"progress_count":10,"completed":true})',
      // NO user_id here. Safe only because `quest.id` came from the owner-scoped
      // read above; frozen as-is, and named in the pull request body.
      'eq("id", "quest-9")',
      'select()',
      'single()',
    ]);
  });

  it('awards the reward XP once, on the transition to complete', async () => {
    const awardPoints = jest.fn(async () => ({}));
    initWith(questFlow({ ...quest, progress_count: 10, completed: true }), { awardPoints });

    await runRoute('post', '/quests/progress', {
      body: { questType: 'review_cards', increment: 2, activityDate: '2026-09-17' },
    });

    expect(awardPoints).toHaveBeenCalledTimes(1);
    expect(awardPoints).toHaveBeenCalledWith(USER, 15, 'Daily quest completed', 'daily_quest');
  });

  it('does not award again for a quest that was already complete', async () => {
    const done = { ...quest, progress_count: 10, completed: true };
    const awardPoints = jest.fn(async () => ({}));
    initWith(
      (_t: string, nth: number) => (nth === 2 || nth === 3 ? { data: done, error: null } : { data: [], error: null }),
      { awardPoints },
    );

    await runRoute('post', '/quests/progress', {
      body: { questType: 'review_cards', increment: 5, activityDate: '2026-09-17' },
    });

    expect(awardPoints).not.toHaveBeenCalled();
  });

  it('skips with a 200 and no update when the caller has no such quest', async () => {
    const rec = initWith((_t, nth) => (nth === 2 ? { data: null, error: null } : { data: [], error: null }));

    const res = await runRoute('post', '/quests/progress', {
      body: { questType: 'not_a_quest', activityDate: '2026-09-17' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, data: null, skipped: true });
    expect(tablesIn(rec.trace)).toHaveLength(3); // seed pair + the miss, no update
  });

  it('rejects a missing questType with 400 before touching the database', async () => {
    const rec = initWith();

    const res = await runRoute('post', '/quests/progress', { body: {} });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'questType is required' });
    expect(tablesIn(rec.trace)).toEqual([]);
  });
});
