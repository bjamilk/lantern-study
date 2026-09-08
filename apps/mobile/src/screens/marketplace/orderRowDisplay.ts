/**
 * The two things that tell one order card apart from the next: a short
 * reference and the date it was placed.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Orders list rendered three identical "Burette ₦700" cards — same title,
 * same price, no date, no reference — so a buyer with a completed, a cancelled
 * and another completed order of the same item could not tell which was which.
 *
 * `orderReference` gives each order a short, stable, human-quotable code (for a
 * "which order?" message to a seller) WITHOUT ever printing the raw order UUID,
 * which plain copy must never show. `orderDateLabel` gives the placed-on date.
 * The row shows "REF · date".
 *
 * The reference is a slice of the id, so it is deterministic and offline —
 * never unique across the whole platform, but unique enough among one buyer's
 * handful of orders, which is all this label is for.
 *
 * The placed-on date uses the SHARED local-calendar formatter, not the UTC one
 * this file used to carry: `created_at` is a UTC instant, and reading it with
 * `getUTCDate` showed the previous day for an order placed after 23:00 WAT (the
 * WAT day had rolled over but the UTC day had not). `formatDisplayDate` reads
 * the viewer's local day, matching every other date in the app. It is still
 * ICU-free, so mobile jest (node env, `*.test.ts` only) stays deterministic.
 */
import { formatDisplayDate } from '@lantern/shared/utils/displayDate';

/**
 * A short reference for an order, e.g. `#3AF9C2`. Derived from the tail of the
 * id (dashes dropped, last 6 alphanumerics, upper-cased). Never the full UUID.
 */
export function orderReference(id?: string | null): string {
  const cleaned = String(id ?? '').replace(/[^a-zA-Z0-9]/g, '');
  if (!cleaned) return '';
  return `#${cleaned.slice(-6).toUpperCase()}`;
}

/** The placed-on date, e.g. `7 Sep 2026`, in the viewer's local calendar day.
 *  Empty when the stamp is missing or unparseable. */
export function orderDateLabel(iso?: string | null): string {
  return formatDisplayDate(iso);
}

/**
 * The one line under an order's title: `#3AF9C2 · 7 Sep 2026`. Either half is
 * dropped if it is missing, and the separator only appears between two halves,
 * so a stampless order still reads cleanly.
 */
export function orderRowMeta(order: { id?: string | null; created_at?: string | null }): string {
  const parts = [orderReference(order.id), orderDateLabel(order.created_at)].filter(Boolean);
  return parts.join(' · ');
}
