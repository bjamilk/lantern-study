/**
 * Query shapes for every database access made by `routes/budget.ts` (lane R2).
 *
 * `routes/budget.ts` had eight `dataLayer.getClient()` escapes — PostgREST
 * chains built inline in the handler — and NO test suite whatsoever. Lane R2
 * moves those queries into `services/data/budget.ts`. A move is only
 * behaviour-preserving if each query still asks the same question, so this test
 * records, per endpoint, the table and every builder call in the order it was
 * applied, and asserts the trace literally.
 *
 * It was written and committed against the UNTOUCHED route, so it is a freeze of
 * what the route did, not a description of what the extraction produced. After
 * the move it drives the same traces through the real `services/data/budget.ts`
 * (see `initWith`), so both halves stay under it.
 *
 * Four expectations here are access control, not cosmetics. The API runs as the
 * SERVICE ROLE, which bypasses RLS, so the `eq("user_id", …)` in
 * `GET /transactions`, `DELETE /transactions/:id`, the under-budget reads and the
 * category-overspend read ARE the only thing keeping one student's ledger out of
 * another's response. Losing one is not a slow query, it is a data leak — which
 * is why the extracted functions take the caller's id as a REQUIRED parameter.
 *
 * Two more that look incidental and are not:
 *   - `POST /transactions` looks the row up by id ALONE (no `user_id` filter) and
 *     compares `existing.user_id` in the route. That is deliberate: filtering by
 *     owner would make another user's id look free, and the route answers 403.
 *   - the category-overspend read's upper bound is `lt(date, <first of next
 *     month>)`. It used to be `${monthYear}-32`, which is not a date, so Postgres
 *     rejected the query and the warning never fired. See the route's comment.
 *
 * What this test deliberately does NOT assert is results: these queries return
 * PostgREST's `{data, error}` untouched and the route branches on `error` itself.
 */
jest.mock('../middleware/auth', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../services/walletService', () => ({
  WalletInsufficientError: class extends Error {},
  getWalletService: () => walletStub,
}));

import router, { initializeBudgetRoutes } from './budget';
import * as budgetData from '../services/data/budget';

let walletStub: Record<string, jest.Mock>;

/** One recorded call: the builder method and the arguments it was given. */
type Call = string;

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
 * A PostgREST double that records the chain instead of running it. Thenable, so
 * `await`ing a builder resolves like a real query; `result` is what every
 * terminal resolves to, so a test can feed the route the row it needs to reach
 * the next query.
 */
type Result = { data: unknown; error: unknown };

function recorder(resolve: Result | ((table: string) => Result) = { data: null, error: null }) {
  const trace: Call[] = [];
  const fmt = (args: unknown[]) => args.map((a) => JSON.stringify(a)).join(', ');
  const resultFor = typeof resolve === 'function' ? resolve : () => resolve;

  const client = {
    from: (table: string) => {
      trace.push(`from(${JSON.stringify(table)})`);
      const builder: any = {
        then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
          Promise.resolve(resultFor(table)).then(ok, err),
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

/**
 * asyncHandler swallows its own promise, so awaiting the handler proves nothing
 * — wait on the response instead. The route body is the last handler on the
 * layer (after authMiddleware and, where present, idempotencyMiddleware, both of
 * which are skipped: `runIdempotent` is supplied on the request below).
 */
async function runRoute(
  method: 'get' | 'post' | 'delete',
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
        body: {},
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

const USER = 'user-1';

/**
 * Init the route family with a `budget` namespace bound to the recording
 * client, exactly the way `data/index.ts` binds it to the real one. The route
 * calls `dataLayer.budget.<fn>(…)`; the REAL data module builds the chain; the
 * recorder captures it. So the trace is still the query the database would see,
 * end to end, and a change in either half shows up here.
 */
function initWith(result?: Result | ((table: string) => Result)) {
  const rec = recorder(result);
  const budget = Object.fromEntries(
    Object.entries(budgetData)
      .filter(([, fn]) => typeof fn === 'function')
      .map(([name, fn]) => [name, (...args: unknown[]) => (fn as any)(rec.client, ...args)]),
  );
  initializeBudgetRoutes({ getClient: () => rec.client, budget } as any, {
    delete: jest.fn(async () => {}),
  } as any);
  return rec;
}

beforeEach(() => {
  walletStub = {
    getBudgetExtras: jest.fn(async () => ({
      walletBalance: 0,
      savingsGoals: [],
      expenseSplits: [],
      categoryBudgets: {},
    })),
    saveBudgetExtras: jest.fn(async () => {}),
    awardWalletOnce: jest.fn(async () => ({ awarded: 0, walletBalance: 0, alreadyAwarded: true })),
    getWalletBalance: jest.fn(async () => 0),
  };
});

describe('POST /goals/:goalId/contribute', () => {
  it('inserts the savings contribution as an investment transaction', async () => {
    const goal = {
      id: 'goal-1',
      name: 'Laptop',
      targetAmount: 1000,
      currentAmount: 0,
    };
    walletStub.getBudgetExtras.mockResolvedValue({
      walletBalance: 0,
      savingsGoals: [goal],
      expenseSplits: [],
      categoryBudgets: {},
    });
    const rec = initWith();

    await runRoute('post', '/goals/:goalId/contribute', {
      params: { goalId: 'goal-1' },
      body: { amount: 100 },
    });

    expect(rec.trace).toHaveLength(2);
    expect(rec.trace[0]).toBe('from("budget_transactions")');
    const inserted = JSON.parse(rec.trace[1].slice('insert('.length, -1));
    expect(inserted).toMatchObject({
      user_id: USER,
      type: 'investment',
      amount: 100,
      category: 'savings',
      description: 'Savings: Laptop',
    });
    expect(inserted.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof inserted.id).toBe('string');
  });
});

describe('POST /awards/under-budget', () => {
  it('reads the previous month limit, then that month expenses, both scoped to the caller', async () => {
    const now = new Date();
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const monthYear = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
    const nextMonth = new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth() + 1, 1));
    const monthEnd = nextMonth.toISOString().slice(0, 10);

    const rec = initWith((table) =>
      table === 'user_budgets'
        ? { data: { monthly_limit: 50000 }, error: null }
        : { data: [], error: null },
    );
    await runRoute('post', '/awards/under-budget', {});

    expect(rec.trace).toEqual([
      'from("user_budgets")',
      'select("monthly_limit")',
      `eq("user_id", "${USER}")`,
      `eq("month_year", "${monthYear}")`,
      'maybeSingle()',
      'from("budget_transactions")',
      'select("amount, type, date")',
      `eq("user_id", "${USER}")`,
      `gte("date", "${monthYear}-01")`,
      `lt("date", "${monthEnd}")`,
    ]);
  });

  it('stops after the budget read when there is no limit for that month', async () => {
    const rec = initWith({ data: null, error: null });
    const res = await runRoute('post', '/awards/under-budget', {});
    expect(res.body.data.reason).toBe('no_budget');
    expect(rec.trace.filter((c) => c.startsWith('from('))).toEqual(['from("user_budgets")']);
  });
});

describe('GET /transactions', () => {
  it('lists the caller own transactions, newest date first', async () => {
    const rec = initWith({ data: [], error: null });
    await runRoute('get', '/transactions', {});

    expect(rec.trace).toEqual([
      'from("budget_transactions")',
      'select("id, user_id, type, amount, category, description, date")',
      `eq("user_id", "${USER}")`,
      'order("date", {"ascending":false})',
    ]);
  });
});

describe('POST /transactions', () => {
  it('upserts on id with no ownership pre-read when the client sends no id', async () => {
    const rec = initWith({ data: null, error: null });
    await runRoute('post', '/transactions', {
      body: { type: 'income', amount: 500, category: 'gifts', date: '2026-03-04' },
    });

    expect(rec.trace[0]).toBe('from("budget_transactions")');
    expect(rec.trace[1]).toMatch(/^upsert\(/);
    expect(rec.trace[1].endsWith(', {"onConflict":"id"})')).toBe(true);
    const upserted = JSON.parse(rec.trace[1].slice('upsert('.length, -', {"onConflict":"id"})'.length));
    expect(upserted).toEqual({
      id: expect.any(String),
      user_id: USER,
      type: 'income',
      amount: 500,
      category: 'gifts',
      description: '',
      date: '2026-03-04',
    });
  });

  it('looks a client-supplied id up by id ALONE, so a foreign row can answer 403', async () => {
    const rec = initWith({ data: { user_id: 'someone-else' }, error: null });
    const res = await runRoute('post', '/transactions', {
      body: {
        id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
        type: 'expense',
        amount: 10,
      },
    });

    expect(res.statusCode).toBe(403);
    expect(rec.trace).toEqual([
      'from("budget_transactions")',
      'select("user_id")',
      'eq("id", "3f2504e0-4f89-41d3-9a0c-0305e82c3301")',
      'maybeSingle()',
    ]);
  });

  it('reads the month category spend with an exclusive first-of-next-month bound', async () => {
    walletStub.getBudgetExtras.mockResolvedValue({
      walletBalance: 0,
      savingsGoals: [],
      expenseSplits: [],
      categoryBudgets: { food: 20000 },
    });
    const rec = initWith({ data: [], error: null });
    await runRoute('post', '/transactions', {
      body: { type: 'expense', amount: 300, category: 'food', date: '2026-12-09' },
    });

    expect(rec.trace.slice(2)).toEqual([
      'from("budget_transactions")',
      'select("amount")',
      `eq("user_id", "${USER}")`,
      'eq("type", "expense")',
      'eq("category", "food")',
      'gte("date", "2026-12-01")',
      'lt("date", "2027-01-01")',
    ]);
  });
});

describe('DELETE /transactions/:transactionId', () => {
  it('deletes by id AND owner, returning the id so a miss can answer 404', async () => {
    const rec = initWith({ data: { id: 'tx-1' }, error: null });
    await runRoute('delete', '/transactions/:transactionId', {
      params: { transactionId: 'tx-1' },
    });

    expect(rec.trace).toEqual([
      'from("budget_transactions")',
      'delete()',
      'eq("id", "tx-1")',
      `eq("user_id", "${USER}")`,
      'select("id")',
      'maybeSingle()',
    ]);
  });

  it('answers 404 when the delete matched nothing', async () => {
    initWith({ data: null, error: null });
    const res = await runRoute('delete', '/transactions/:transactionId', {
      params: { transactionId: 'tx-1' },
    });
    expect(res.statusCode).toBe(404);
  });
});
