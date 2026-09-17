/**
 * Query shapes for the marketplace reconciliation candidate scan (#113).
 *
 * These queries decide which rows a money-repair job will look at, so each one
 * is pinned the way `adminData.queryShape.test.ts` pins the admin console's: a
 * recording double stands in for PostgREST, every builder method appends
 * `name(args)` to a trace, and the trace is asserted literally.
 *
 * Four of the expectations are the spec, not decoration:
 *
 *   - `select('*')` everywhere. `payout_attempt` arrives with a hand-applied
 *     migration, and naming a column the database does not have fails the whole
 *     query — a reconciler that goes blind on an un-migrated database is worse
 *     than one that reads a column too many.
 *   - `lt('updated_at', …)` for the four CLAIM classes. Age must be measured on
 *     the column the claim write itself bumps; `created_at` would report an old
 *     order whose payout was claimed a minute ago as ancient and hand the job a
 *     live row.
 *   - `lt('created_at', …)` for the two `initialized` classes, which are never
 *     updated between initialize and settlement.
 *   - `order(… ascending) limit(n)`. Oldest first and always capped, because
 *     every candidate costs a Paystack call.
 */
jest.mock('../../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import type { DataClient } from './client';
import * as reconcileData from './marketplaceReconcile';

const CHAIN_METHODS = [
  'select',
  'eq',
  'is',
  'not',
  'lt',
  'order',
  'limit',
  'maybeSingle',
] as const;

function fmt(args: unknown[]): string {
  return args.map((a) => JSON.stringify(a)).join(', ');
}

/** A PostgREST double that records the chain instead of running it. */
function recorder() {
  const trace: string[] = [];
  const result = { data: [], error: null };

  const builder: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  for (const method of CHAIN_METHODS) {
    builder[method] = (...args: unknown[]) => {
      trace.push(`${method}(${fmt(args)})`);
      return builder;
    };
  }

  const client = {
    from: (table: string) => {
      trace.push(`from(${JSON.stringify(table)})`);
      return builder;
    },
  } as unknown as DataClient;

  return { client, trace };
}

const WINDOW = { olderThanIso: '2026-09-17T09:00:00.000Z', limit: 25 };

describe('marketplace reconciliation candidate queries', () => {
  it('finds payments holding the refund claim, oldest first, by updated_at', async () => {
    const { client, trace } = recorder();
    await reconcileData.listStuckRefundingPayments(client, WINDOW);
    expect(trace).toEqual([
      'from("marketplace_payments")',
      'select("*")',
      'eq("status", "refunding")',
      'lt("updated_at", "2026-09-17T09:00:00.000Z")',
      'order("updated_at", {"ascending":true})',
      'limit(25)',
    ]);
  });

  it('finds payments holding the payout claim, oldest first, by updated_at', async () => {
    const { client, trace } = recorder();
    await reconcileData.listStuckPayoutPendingPayments(client, WINDOW);
    expect(trace).toEqual([
      'from("marketplace_payments")',
      'select("*")',
      'eq("status", "payout_pending")',
      'lt("updated_at", "2026-09-17T09:00:00.000Z")',
      'order("updated_at", {"ascending":true})',
      'limit(25)',
    ]);
  });

  it('finds the orphan initialized payments by their missing links and created_at', async () => {
    const { client, trace } = recorder();
    await reconcileData.listOrphanInitializedPayments(client, WINDOW);
    expect(trace).toEqual([
      'from("marketplace_payments")',
      'select("*")',
      'eq("status", "initialized")',
      'is("order_id", null)',
      'is("checkout_id", null)',
      'lt("created_at", "2026-09-17T09:00:00.000Z")',
      'order("created_at", {"ascending":true})',
      'limit(25)',
    ]);
  });

  it('finds initialized payments that DO name an order, for the settlement check', async () => {
    const { client, trace } = recorder();
    await reconcileData.listUnsettledInitializedPayments(client, WINDOW);
    expect(trace).toEqual([
      'from("marketplace_payments")',
      'select("*")',
      'eq("status", "initialized")',
      'not("order_id", "is", null)',
      'lt("created_at", "2026-09-17T09:00:00.000Z")',
      'order("created_at", {"ascending":true})',
      'limit(25)',
    ]);
  });

  it('finds orders holding the per-order payout claim', async () => {
    const { client, trace } = recorder();
    await reconcileData.listStuckPayingOrders(client, WINDOW);
    expect(trace).toEqual([
      'from("marketplace_orders")',
      'select("*")',
      'eq("payout_status", "paying")',
      'lt("updated_at", "2026-09-17T09:00:00.000Z")',
      'order("updated_at", {"ascending":true})',
      'limit(25)',
    ]);
  });

  it('finds orders holding the per-order refund hold', async () => {
    const { client, trace } = recorder();
    await reconcileData.listStuckRefundHoldOrders(client, WINDOW);
    expect(trace).toEqual([
      'from("marketplace_orders")',
      'select("*")',
      'eq("payout_status", "refund_hold")',
      'lt("updated_at", "2026-09-17T09:00:00.000Z")',
      'order("updated_at", {"ascending":true})',
      'limit(25)',
    ]);
  });

  it('reads one order and one payment by id', async () => {
    const order = recorder();
    await reconcileData.getOrderForReconcile(order.client, 'order-1');
    expect(order.trace).toEqual([
      'from("marketplace_orders")',
      'select("*")',
      'eq("id", "order-1")',
      'maybeSingle()',
    ]);

    const payment = recorder();
    await reconcileData.getPaymentForReconcile(payment.client, 'pay-1');
    expect(payment.trace).toEqual([
      'from("marketplace_payments")',
      'select("*")',
      'eq("id", "pay-1")',
      'maybeSingle()',
    ]);
  });

  it('reads a cart checkout\'s sibling orders with their status and payout_status', async () => {
    const { client, trace } = recorder();
    await reconcileData.listCheckoutSiblingOrders(client, 'checkout-1');
    expect(trace).toEqual([
      'from("marketplace_orders")',
      'select("id, status, payout_status")',
      'eq("checkout_id", "checkout-1")',
    ]);
  });

  it('issues no write of any kind', () => {
    // The module is a READ. A repair re-applies the original write, with the
    // original CAS filters, at the site that owns it — never here.
    const source = require('fs').readFileSync(`${__dirname}/marketplaceReconcile.ts`, 'utf8');
    expect(source).not.toMatch(/\.(update|insert|upsert|delete)\(/);
  });
});
