/**
 * marketplace_reports.reason has a DB CHECK constraint on exactly these four
 * values. Clients (mobile in particular) also send richer reasons like
 * wrong_category / prohibited_item, which used to bounce off the constraint —
 * fold them into 'other' and keep the specific label in details so admin
 * triage still sees what the reporter actually picked.
 */
const CANONICAL_REPORT_REASONS = new Set(["scam", "spam", "inappropriate", "other"]);

export function normalizeMarketplaceReportReason(
  rawReason: string | null | undefined,
  rawDetails: string | null | undefined,
): { reason: string; details: string | undefined } {
  const reason = String(rawReason || "other");
  if (CANONICAL_REPORT_REASONS.has(reason)) {
    return { reason, details: rawDetails ?? undefined };
  }
  const label = reason.replace(/_/g, " ");
  return {
    reason: "other",
    details: `[${label}] ${rawDetails || ""}`.trim(),
  };
}
