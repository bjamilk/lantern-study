/**
 * data/productEvents.ts — the product analytics event stream.
 *
 * ## Purpose
 *
 * Extracted verbatim from `routes/analytics.ts` (monolith lane R2, PR 2b). One
 * chain. The route keeps every decision: the shared allowlist that says which
 * event names exist, the 25-event batch cap, the prop sanitiser, the rule that a
 * signed-out caller must supply an `anon_id`, and the 500 it answers on failure.
 *
 * ## What it touches
 *
 * Table: `product_events`. No storage buckets, no RPCs.
 *
 * ## The gotcha: the rows are already trusted, and the write's error is not lost
 *
 * `user_id` here is NOT an access predicate — it is a column on an append-only
 * event, stamped by the route from the authenticated request (or left null for a
 * guest, who is identified by `anon_id` instead). There is nothing to scope: a
 * caller can only ever insert, never read this table back.
 *
 * What DOES matter is the return value. supabase-js RESOLVES with `{ error }`
 * on a failed write rather than throwing, and 87 sites in this API drop it
 * (issue #108). This one does not, and must not start: the caller reads the
 * error and answers 500 so a client knows to retry the batch. Returning
 * `{ error }` rather than `void` is what keeps that possible.
 */
import type { DataClient } from "./client";

/** One accepted, sanitised batch. Returns the write's error for the caller. */
export async function insertProductEvents(
  supabase: DataClient,
  rows: ReadonlyArray<Record<string, unknown>>,
): Promise<{ error: any }> {
  const { error } = await supabase.from("product_events").insert(rows);
  return { error };
}
