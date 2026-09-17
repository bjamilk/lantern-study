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
  'in',
  'not',
  'lt',
  'order',
  'limit',
  'maybeSingle',
  'update',
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
const NOW = '2026-09-17T12:00:00.000Z';

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

  it('issues no insert, upsert or delete — a repair is an UPDATE of a claimed row', () => {
    // Phase B added nine updates, each a copy of an original money-path write.
    // Nothing here may create or destroy a money row.
    const source = require('fs').readFileSync(`${__dirname}/marketplaceReconcile.ts`, 'utf8');
    expect(source).not.toMatch(/\.(insert|upsert|delete)\(/);
  });
});

/**
 * The nine repairs, pinned the same way (#113, Phase B).
 *
 * Read each expectation against the ORIGINAL write in
 * `services/marketplacePayments.ts` that it copies: the update payload is the
 * same and — the part that matters — so is every filter. The CAS is what makes
 * a repair safe to run twice and safe to run late; a filter dropped here would
 * turn a no-op into an overwrite of whatever the row says now.
 *
 * `select('id')` is the one addition, and it is not a filter: it is the
 * RETURNING clause that lets the caller tell "repaired" from "matched nothing".
 */
describe('marketplace reconciliation repair writes', () => {
  it('class 1 — stamps a refund Paystack has already paid', async () => {
    const { client, trace } = recorder();
    await reconcileData.stampPaymentRefunded(client, {
      paymentId: 'pay-1',
      refundReference: 'rf_1',
      nowIso: NOW,
    });
    expect(trace).toEqual([
      'from("marketplace_payments")',
      'update({"status":"refunded","refund_reference":"rf_1","updated_at":"2026-09-17T12:00:00.000Z"})',
      'eq("id", "pay-1")',
      'eq("status", "refunding")',
      'select("id")',
    ]);
  });

  it('class 3 — releases the refund claim back to paid', async () => {
    const { client, trace } = recorder();
    await reconcileData.releasePaymentRefundClaim(client, { paymentId: 'pay-1', nowIso: NOW });
    expect(trace).toEqual([
      'from("marketplace_payments")',
      'update({"status":"paid","updated_at":"2026-09-17T12:00:00.000Z"})',
      'eq("id", "pay-1")',
      'eq("status", "refunding")',
      'select("id")',
    ]);
  });

  it('class 4 — marks a refunded order unpayable', async () => {
    const { client, trace } = recorder();
    await reconcileData.markOrderRefundedNotPayable(client, { orderId: 'order-1' });
    expect(trace).toEqual([
      'from("marketplace_orders")',
      'update({"payout_status":"skipped","payout_failed_reason":"refunded"})',
      'eq("id", "order-1")',
      'eq("payout_status", "refund_hold")',
      'select("id")',
    ]);
  });

  it('class 5 — gives a refund hold back to the payout machine', async () => {
    const { client, trace } = recorder();
    await reconcileData.releaseOrderRefundHold(client, { orderId: 'order-1' });
    expect(trace).toEqual([
      'from("marketplace_orders")',
      'update({"payout_status":"pending"})',
      'eq("id", "order-1")',
      'eq("payout_status", "refund_hold")',
      'select("id")',
    ]);
  });

  it('class 6 — releases a payout claim no transfer is backing', async () => {
    const { client, trace } = recorder();
    await reconcileData.releaseOrderPayoutClaim(client, { orderId: 'order-1', reason: 'why' });
    expect(trace).toEqual([
      'from("marketplace_orders")',
      'update({"payout_status":"pending","payout_failed_reason":"why"})',
      'eq("id", "order-1")',
      'eq("payout_status", "paying")',
      'select("id")',
    ]);
  });

  it('class 7 — settles an order whose transfer succeeded', async () => {
    const { client, trace } = recorder();
    await reconcileData.settleOrderPayout(client, { orderId: 'order-1' });
    expect(trace).toEqual([
      'from("marketplace_orders")',
      'update({"payout_status":"paid_out","payout_failed_reason":null})',
      'eq("id", "order-1")',
      'in("payout_status", ["paying","pending"])',
      'select("id")',
    ]);
  });

  it('class 8 — releases a payment payout claim, conditional on ITS claim marker', async () => {
    const { client, trace } = recorder();
    await reconcileData.releasePaymentPayoutClaim(client, {
      paymentId: 'pay-1',
      claimMarker: 'claim:ls_po_abc',
      reason: 'why',
      nowIso: NOW,
    });
    expect(trace).toEqual([
      'from("marketplace_payments")',
      'update({"status":"paid","payout_transfer_code":null,"payout_failed_reason":"why","updated_at":"2026-09-17T12:00:00.000Z"})',
      'eq("id", "pay-1")',
      'eq("status", "payout_pending")',
      // Without this filter the release could clear a transfer another caller
      // has already stamped as live (H11).
      'eq("payout_transfer_code", "claim:ls_po_abc")',
      'select("id")',
    ]);
  });

  it('class 9 — stamps the real transfer code, only for the claim holder', async () => {
    const { client, trace } = recorder();
    await reconcileData.stampPaymentTransferCode(client, {
      paymentId: 'pay-1',
      claimMarker: 'claim:ls_po_abc',
      transferCode: 'TRF_9',
      nowIso: NOW,
    });
    expect(trace).toEqual([
      'from("marketplace_payments")',
      'update({"payout_transfer_code":"TRF_9","updated_at":"2026-09-17T12:00:00.000Z"})',
      'eq("id", "pay-1")',
      'eq("payout_transfer_code", "claim:ls_po_abc")',
      'select("id")',
    ]);
  });

  it('class 10 — settles the payment row after a successful transfer', async () => {
    const { client, trace } = recorder();
    await reconcileData.settlePaymentPaidOut(client, { paymentId: 'pay-1', nowIso: NOW });
    expect(trace).toEqual([
      'from("marketplace_payments")',
      'update({"status":"paid_out","payout_at":"2026-09-17T12:00:00.000Z","updated_at":"2026-09-17T12:00:00.000Z"})',
      'eq("id", "pay-1")',
      'in("status", ["payout_pending","paid"])',
      'select("id")',
    ]);
  });
});
