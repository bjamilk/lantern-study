/**
 * data/marketplaceReconcile.ts — the candidate queries for marketplace money
 * reconciliation (#113).
 *
 * ## Purpose
 *
 * `reconcileLaterWrite` (see `data/writeResult.ts`) exists for the writes that
 * failed AFTER Paystack had already moved money. It answers the user
 * truthfully and reports, and nothing puts the row right. This module is the
 * first half of the job that does: it finds the WEDGED ROWS BY STATE, straight
 * out of the two money tables, so the reconciler never has to parse a Sentry
 * event to know what to look at. The Sentry events are the cross-check that
 * these queries find the right rows, not the input.
 *
 * The first half of the module is READS: the candidate scan. The second half,
 * added in Phase B, is the REPAIRS — and every one of them is the ORIGINAL
 * write from `services/marketplacePayments.ts` with the ORIGINAL compare-and-set
 * filters, so applying it to a row that has moved on matches nothing and
 * changes nothing. There is no write here that is not a copy of one that
 * already exists on the money path, and no repair may ever be added without its
 * original.
 *
 * Each repair returns the rows it matched (`.select('id')`). That RETURNING
 * clause is the ONLY difference from the original write, and it is what lets
 * the caller tell "repaired" from "the CAS matched nothing, so somebody or
 * something already fixed it" — which must never be reported as a fresh
 * success. The caller passes the result to `mustWrite`.
 *
 * ## What it touches
 *
 * Tables `marketplace_payments` and `marketplace_orders`. No storage, no RPC.
 * `marketplace_payments` enters the data layer's frozen table inventory with
 * this module — every query against it used to live in
 * `services/marketplacePayments.ts`, which that scan does not cover.
 *
 * ## Gotchas
 *
 * 1. **`select('*')`, deliberately.** `payout_attempt` is added by a
 *    hand-applied migration (`20260915140000`), and naming a column the
 *    database does not have yet fails the WHOLE query. The money path takes the
 *    same care for the same reason; a reconciler that goes blind on an
 *    un-migrated database is worse than one that reads a column too many.
 *
 * 2. **Age is measured on `updated_at`, not `created_at`.** A claim is taken by
 *    an UPDATE, and `marketplace_orders` has a BEFORE UPDATE trigger that
 *    stamps `updated_at`, while every claim write on `marketplace_payments`
 *    sets it explicitly. An unrelated later update only makes a row look
 *    YOUNGER, which makes the job skip it — the safe direction. `created_at`
 *    would do the opposite: an old order whose payout was claimed a minute ago
 *    would read as ancient.
 *
 * 3. **Oldest first, and always capped.** Every query orders by the age column
 *    ascending and takes an explicit `limit`, because each candidate costs one
 *    or more Paystack calls and a run must have a bounded cost.
 */
import type { DataClient } from "./client";

/** A `marketplace_payments` row as the planner reads it. `select('*')`. */
export type ReconcilePaymentRow = {
  id: string;
  order_id: string | null;
  checkout_id: string | null;
  status: string;
  paystack_reference: string | null;
  paystack_transaction_id: string | null;
  payout_transfer_code: string | null;
  payout_attempt?: number | null;
  refund_reference: string | null;
  total_charged_kobo: number | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

/** A `marketplace_orders` row as the planner reads it. `select('*')`. */
export type ReconcileOrderRow = {
  id: string;
  payment_id: string | null;
  checkout_id: string | null;
  status: string;
  payout_status: string;
  payout_reference: string | null;
  payout_transfer_code: string | null;
  payout_attempt?: number | null;
  created_at: string;
  updated_at: string;
};

type Window = {
  /** ISO timestamp; rows last touched before it are candidates. */
  olderThanIso: string;
  /** Hard per-class cap. Every caller passes one. */
  limit: number;
};

/**
 * Payments holding the REFUND claim (`paid -> refunding`) past the window.
 *
 * The claim is held only across one `POST /refund` call inside one request, so
 * an old one means that request is over: either the `refunded` stamp failed
 * (money went back, row says `refunding`) or the rollback did (nothing went
 * back, row still says `refunding`). Both refuse every later refund AND the
 * payout until somebody puts the row right.
 */
export async function listStuckRefundingPayments(
  supabase: DataClient,
  { olderThanIso, limit }: Window,
): Promise<{ data: ReconcilePaymentRow[] | null; error: any }> {
  const { data, error } = await supabase
    .from("marketplace_payments")
    .select("*")
    .eq("status", "refunding")
    .lt("updated_at", olderThanIso)
    .order("updated_at", { ascending: true })
    .limit(limit);
  return { data: (data as ReconcilePaymentRow[] | null) ?? null, error };
}

/**
 * Payments holding the PAYOUT claim (`paid -> payout_pending`) past the window.
 *
 * Two very different rows come back and the planner, not this query, tells them
 * apart: one whose `payout_transfer_code` is still the `claim:<reference>`
 * marker (no real transfer was ever stamped) and one carrying a real transfer
 * code, which may be legitimately waiting for `transfer.success` for days.
 */
export async function listStuckPayoutPendingPayments(
  supabase: DataClient,
  { olderThanIso, limit }: Window,
): Promise<{ data: ReconcilePaymentRow[] | null; error: any }> {
  const { data, error } = await supabase
    .from("marketplace_payments")
    .select("*")
    .eq("status", "payout_pending")
    .lt("updated_at", olderThanIso)
    .order("updated_at", { ascending: true })
    .limit(limit);
  return { data: (data as ReconcilePaymentRow[] | null) ?? null, error };
}

/**
 * Payments still `initialized` past the window with no order and no checkout
 * behind them — the orphan #112 deliberately leaves when the order → payment
 * link write fails.
 *
 * Report-only by design: `initialized` already means "no money captured", and
 * nothing can settle a reference no Paystack session was ever opened for.
 */
export async function listOrphanInitializedPayments(
  supabase: DataClient,
  { olderThanIso, limit }: Window,
): Promise<{ data: ReconcilePaymentRow[] | null; error: any }> {
  const { data, error } = await supabase
    .from("marketplace_payments")
    .select("*")
    .eq("status", "initialized")
    .is("order_id", null)
    .is("checkout_id", null)
    .lt("created_at", olderThanIso)
    .order("created_at", { ascending: true })
    .limit(limit);
  return { data: (data as ReconcilePaymentRow[] | null) ?? null, error };
}

/**
 * Payments still `initialized` past the window that DO name an order or a
 * checkout: the shape a captured-but-never-settled charge takes when no
 * `charge.success` webhook ever landed and the buyer never came back through
 * the verify route.
 *
 * `created_at` is the right clock here — the row is never updated between
 * initialize and settlement — and this class is capped separately, because most
 * of these rows are simply abandoned checkouts and each one costs a verify call.
 */
export async function listUnsettledInitializedPayments(
  supabase: DataClient,
  { olderThanIso, limit }: Window,
): Promise<{ data: ReconcilePaymentRow[] | null; error: any }> {
  const { data, error } = await supabase
    .from("marketplace_payments")
    .select("*")
    .eq("status", "initialized")
    .not("order_id", "is", null)
    .lt("created_at", olderThanIso)
    .order("created_at", { ascending: true })
    .limit(limit);
  return { data: (data as ReconcilePaymentRow[] | null) ?? null, error };
}

/**
 * Orders holding the per-order PAYOUT claim (`pending -> paying`) past the
 * window. The claim is a single slot with no expiry and no sweeper: an order
 * left here can never be claimed again, so the seller is never paid.
 */
export async function listStuckPayingOrders(
  supabase: DataClient,
  { olderThanIso, limit }: Window,
): Promise<{ data: ReconcileOrderRow[] | null; error: any }> {
  const { data, error } = await supabase
    .from("marketplace_orders")
    .select("*")
    .eq("payout_status", "paying")
    .lt("updated_at", olderThanIso)
    .order("updated_at", { ascending: true })
    .limit(limit);
  return { data: (data as ReconcileOrderRow[] | null) ?? null, error };
}

/**
 * Orders holding the per-order REFUND claim (`pending -> refund_hold`) past the
 * window. It blocks the payout — the safe direction — but never releases, and
 * it also refuses every later refund for that order.
 */
export async function listStuckRefundHoldOrders(
  supabase: DataClient,
  { olderThanIso, limit }: Window,
): Promise<{ data: ReconcileOrderRow[] | null; error: any }> {
  const { data, error } = await supabase
    .from("marketplace_orders")
    .select("*")
    .eq("payout_status", "refund_hold")
    .lt("updated_at", olderThanIso)
    .order("updated_at", { ascending: true })
    .limit(limit);
  return { data: (data as ReconcileOrderRow[] | null) ?? null, error };
}

/**
 * One payment's own order row, for the single-order (`checkout_id` null) shape,
 * where the payout claim lives on the payment and the planner still wants to
 * name the order in its finding.
 */
export async function getOrderForReconcile(
  supabase: DataClient,
  orderId: string,
): Promise<{ data: ReconcileOrderRow | null; error: any }> {
  const { data, error } = await supabase
    .from("marketplace_orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();
  return { data: (data as ReconcileOrderRow | null) ?? null, error };
}

/**
 * One order's payment row, for the refund-hold class: the order names the
 * payment, and only the payment carries the Paystack charge key the refund
 * lookup needs.
 */
export async function getPaymentForReconcile(
  supabase: DataClient,
  paymentId: string,
): Promise<{ data: ReconcilePaymentRow | null; error: any }> {
  const { data, error } = await supabase
    .from("marketplace_payments")
    .select("*")
    .eq("id", paymentId)
    .maybeSingle();
  return { data: (data as ReconcilePaymentRow | null) ?? null, error };
}

/**
 * The sibling orders of one cart checkout, exactly as the refund path reads
 * them: it releases the shared payment row back to `paid` rather than stamping
 * it `refunded` while any sibling is still open, so the planner cannot tell
 * those two repairs apart without this.
 */
export async function listCheckoutSiblingOrders(
  supabase: DataClient,
  checkoutId: string,
): Promise<{ data: Array<{ id: string; status: string; payout_status: string }> | null; error: any }> {
  const { data, error } = await supabase
    .from("marketplace_orders")
    .select("id, status, payout_status")
    .eq("checkout_id", checkoutId);
  return {
    data: (data as Array<{ id: string; status: string; payout_status: string }> | null) ?? null,
    error,
  };
}

// --- The repairs (Phase B) ---------------------------------------------------
//
// One function per repairable class. Each is the original write, with the
// original CAS filters, plus `.select('id')` so the caller can tell a repair
// from a no-op. None of them decides anything: the planner decides, from what
// Paystack said, and the apply path re-plans before calling any of these.

/** What a repair write answers: the rows its CAS matched, and the write error. */
export type RepairResult = { data: Array<{ id: string }> | null; error: any };

/**
 * Class 1 — the `refunded` + `refund_reference` stamp Paystack has already
 * honoured (`marketplacePayments.ts:2017`).
 */
export async function stampPaymentRefunded(
  supabase: DataClient,
  input: { paymentId: string; refundReference: string; nowIso: string },
): Promise<RepairResult> {
  const { data, error } = await supabase
    .from("marketplace_payments")
    .update({
      status: "refunded",
      refund_reference: input.refundReference,
      updated_at: input.nowIso,
    })
    .eq("id", input.paymentId)
    .eq("status", "refunding")
    .select("id");
  return { data: (data as Array<{ id: string }> | null) ?? null, error };
}

/**
 * Class 3 — the refund rollback that never ran (`:1983`). A CLAIM RELEASE: the
 * caller may only reach it on a positive "no refund accepted for this charge".
 */
export async function releasePaymentRefundClaim(
  supabase: DataClient,
  input: { paymentId: string; nowIso: string },
): Promise<RepairResult> {
  const { data, error } = await supabase
    .from("marketplace_payments")
    .update({ status: "paid", updated_at: input.nowIso })
    .eq("id", input.paymentId)
    .eq("status", "refunding")
    .select("id");
  return { data: (data as Array<{ id: string }> | null) ?? null, error };
}

/** Class 4 — the refunded order that must never pay out (`:2071`). */
export async function markOrderRefundedNotPayable(
  supabase: DataClient,
  input: { orderId: string },
): Promise<RepairResult> {
  const { data, error } = await supabase
    .from("marketplace_orders")
    .update({ payout_status: "skipped", payout_failed_reason: "refunded" })
    .eq("id", input.orderId)
    .eq("payout_status", "refund_hold")
    .select("id");
  return { data: (data as Array<{ id: string }> | null) ?? null, error };
}

/**
 * Class 5 — `releaseRefundHold` (`:2119`). A CLAIM RELEASE, on a positive
 * "no refund accepted for this charge" and nothing else.
 */
export async function releaseOrderRefundHold(
  supabase: DataClient,
  input: { orderId: string },
): Promise<RepairResult> {
  const { data, error } = await supabase
    .from("marketplace_orders")
    .update({ payout_status: "pending" })
    .eq("id", input.orderId)
    .eq("payout_status", "refund_hold")
    .select("id");
  return { data: (data as Array<{ id: string }> | null) ?? null, error };
}

/**
 * Class 6 — `releaseOrderPayoutClaim` (`:1629`). A CLAIM RELEASE, on a positive
 * Paystack 404 for the transfer reference and only while the order carries no
 * transfer code.
 */
export async function releaseOrderPayoutClaim(
  supabase: DataClient,
  input: { orderId: string; reason: string },
): Promise<RepairResult> {
  const { data, error } = await supabase
    .from("marketplace_orders")
    .update({ payout_status: "pending", payout_failed_reason: input.reason.slice(0, 500) })
    .eq("id", input.orderId)
    .eq("payout_status", "paying")
    .select("id");
  return { data: (data as Array<{ id: string }> | null) ?? null, error };
}

/**
 * Class 7 — `finalizeOrderPayout`'s settle (`:1672`). The roll-up to the shared
 * payment row is deliberately NOT part of this repair; class 10 settles that,
 * per row, on a later plan.
 */
export async function settleOrderPayout(
  supabase: DataClient,
  input: { orderId: string },
): Promise<RepairResult> {
  const { data, error } = await supabase
    .from("marketplace_orders")
    .update({ payout_status: "paid_out", payout_failed_reason: null })
    .eq("id", input.orderId)
    .in("payout_status", ["paying", "pending"])
    .select("id");
  return { data: (data as Array<{ id: string }> | null) ?? null, error };
}

/**
 * Class 8 — the payout rollback (`:1581`). A CLAIM RELEASE, conditional on THIS
 * attempt's claim marker exactly as the original was: a release must never
 * clear a transfer another caller has stamped as live.
 */
export async function releasePaymentPayoutClaim(
  supabase: DataClient,
  input: { paymentId: string; claimMarker: string; reason: string; nowIso: string },
): Promise<RepairResult> {
  const { data, error } = await supabase
    .from("marketplace_payments")
    .update({
      status: "paid",
      payout_transfer_code: null,
      payout_failed_reason: input.reason.slice(0, 500),
      updated_at: input.nowIso,
    })
    .eq("id", input.paymentId)
    .eq("status", "payout_pending")
    .eq("payout_transfer_code", input.claimMarker)
    .select("id");
  return { data: (data as Array<{ id: string }> | null) ?? null, error };
}

/**
 * Class 9 — the post-transfer code stamp (`:1546`). Only the holder of the
 * claim may stamp the real code, which is what the marker filter enforces.
 */
export async function stampPaymentTransferCode(
  supabase: DataClient,
  input: { paymentId: string; claimMarker: string; transferCode: string; nowIso: string },
): Promise<RepairResult> {
  const { data, error } = await supabase
    .from("marketplace_payments")
    .update({ payout_transfer_code: input.transferCode, updated_at: input.nowIso })
    .eq("id", input.paymentId)
    .eq("payout_transfer_code", input.claimMarker)
    .select("id");
  return { data: (data as Array<{ id: string }> | null) ?? null, error };
}

/** Class 10 — `markPaymentPaidOut` (`:1825`). */
export async function settlePaymentPaidOut(
  supabase: DataClient,
  input: { paymentId: string; nowIso: string },
): Promise<RepairResult> {
  const { data, error } = await supabase
    .from("marketplace_payments")
    .update({ status: "paid_out", payout_at: input.nowIso, updated_at: input.nowIso })
    .eq("id", input.paymentId)
    .in("status", ["payout_pending", "paid"])
    .select("id");
  return { data: (data as Array<{ id: string }> | null) ?? null, error };
}
