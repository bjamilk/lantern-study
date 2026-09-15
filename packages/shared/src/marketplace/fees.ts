// ===========================================
// Lantern Study - Marketplace fee model
// ===========================================
//
// PURPOSE
//   The ONE calculator for what a buyer is charged and what a seller receives.
//   Every price shown, every Paystack charge assembled and every payout figure
//   must come from here. A second copy of this arithmetic anywhere is a bug
//   waiting to charge someone the wrong amount.
//
// CONSUMERS
//   web + mobile — for the price and breakdown shown BEFORE a student pays.
//   api          — for the charge actually created and the payout recorded.
//   All three read the same env-driven basis points, so the number quoted and
//   the number charged cannot diverge.
//
// THE MODEL (since 2026-09-02)
//   The hand-over fee lives INSIDE the price. The buyer pays the LIST price;
//   Lantern's 5% comes out of the seller's payout, so the seller receives 95%.
//   Before that date the buyer paid list + 5%, which is why
//   MARKETPLACE_DEFAULT_SERVICE_FEE_BPS is now 0 rather than deleted — the
//   surcharge path still exists behind an env var, and nothing may assume it
//   is non-zero. Never add a fee on top at checkout.
//
// MONEY IS IN KOBO
//   All internal amounts are integer kobo (1 naira = 100 kobo). Convert at the
//   edges with nairaToKobo / koboToNaira and never carry a float through the
//   arithmetic — a rounding error here is a real charge.
//
// BASIS POINTS
//   Fees are bps (1% = 100 bps), resolved from env by the `resolve*` helpers so
//   the server and the clients read the same configuration:
//     MARKETPLACE_SERVICE_FEE_BPS          buyer surcharge, hand-over (0)
//     MARKETPLACE_PHYSICAL_COMMISSION_BPS  seller commission, hand-over (500)
//     MARKETPLACE_DIGITAL_BUYER_FEE_BPS    buyer surcharge, digital (0)
//     MARKETPLACE_CREATOR_FEE_BPS          platform cut, digital (1500)
//
// GOTCHAS
//   - `packages/shared` is consumed BUILT: run `npm run build` in
//     packages/shared before typechecking or running web/mobile, or consumers
//     resolve a stale `dist/`.
//   - A NEW subpath under src/ needs the file, a `packages/shared/package.json`
//     "exports" entry, AND an `apps/api-server/tsconfig.json` "paths" entry.
//     Mobile jest maps `@lantern/shared/*` subpaths separately, so a subpath
//     imported only by a test fails CI-only with TS2307 (`jest --no-cache`).
//   - The web turbo build compiles with strict `noUncheckedIndexedAccess`.

/**
 * Buyer-side surcharge on hand-over items. Default 0: the buyer pays the LIST
 * price. It was 500 (5% on top) until 2026-09-02, when the fee moved into the
 * price — Lantern's 5% now comes out of the seller's payout instead (see
 * MARKETPLACE_DEFAULT_PHYSICAL_COMMISSION_BPS). Env MARKETPLACE_SERVICE_FEE_BPS
 * can re-enable a surcharge; nothing in the app assumes it is non-zero.
 */
export const MARKETPLACE_DEFAULT_SERVICE_FEE_BPS = 0;
/**
 * Platform commission taken from the SELLER's payout on hand-over items.
 * Default 500 = 5%. This is the fee that used to be charged to the buyer on top.
 */
export const MARKETPLACE_DEFAULT_PHYSICAL_COMMISSION_BPS = 500;

export type MarketplaceFeeBreakdown = {
  itemAmountKobo: number;
  serviceFeeKobo: number;
  totalChargeKobo: number;
  serviceFeeBps: number;
};

/** Convert Naira (may be float from DB) to integer kobo. */
// ---------------------------------------------------------------------------
// Currency conversion
// ---------------------------------------------------------------------------

export function nairaToKobo(naira: number): number {
  if (!Number.isFinite(naira) || naira < 0) {
    throw new Error('Invalid Naira amount');
  }
  return Math.round(naira * 100);
}

export function koboToNaira(kobo: number): number {
  if (!Number.isFinite(kobo) || kobo < 0) {
    throw new Error('Invalid kobo amount');
  }
  return kobo / 100;
}

/**
 * Optional buyer-side surcharge on top of the item total — display math for
 * clients. The default rate is 0 since the hand-over fee moved into the price;
 * pass a rate explicitly to quote one. All math in integer kobo.
 */
// ---------------------------------------------------------------------------
// Hand-over (physical) checkout
// ---------------------------------------------------------------------------

export function computeMarketplaceCheckoutFees(
  itemAmountKobo: number,
  serviceFeeBps: number = MARKETPLACE_DEFAULT_SERVICE_FEE_BPS
): MarketplaceFeeBreakdown {
  if (!Number.isInteger(itemAmountKobo) || itemAmountKobo < 0) {
    throw new Error('itemAmountKobo must be a non-negative integer');
  }
  if (!Number.isInteger(serviceFeeBps) || serviceFeeBps < 0 || serviceFeeBps > 10_000) {
    throw new Error('serviceFeeBps must be an integer between 0 and 10000');
  }
  const serviceFeeKobo = Math.round((itemAmountKobo * serviceFeeBps) / 10_000);
  return {
    itemAmountKobo,
    serviceFeeKobo,
    totalChargeKobo: itemAmountKobo + serviceFeeKobo,
    serviceFeeBps,
  };
}

export function isMarketplacePaystackCheckoutEnabled(
  flag: string | undefined | null = typeof process !== 'undefined'
    ? process.env?.MARKETPLACE_PAYSTACK_CHECKOUT
    : undefined
): boolean {
  if (!flag) return false;
  const v = String(flag).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export function resolveMarketplaceServiceFeeBps(
  raw: string | undefined | null = typeof process !== 'undefined'
    ? process.env?.MARKETPLACE_SERVICE_FEE_BPS
    : undefined
): number {
  if (raw == null || String(raw).trim() === '') return MARKETPLACE_DEFAULT_SERVICE_FEE_BPS;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 0 || n > 10_000) return MARKETPLACE_DEFAULT_SERVICE_FEE_BPS;
  return n;
}

// ── Fee model (Phase 2 · I) — configuration, not a fork ──────────────────────
// Every listing: the buyer pays the LIST price and the platform's cut comes out
// of the seller's payout — 15% on digital (question banks, study packs), 5% on
// hand-over items. Until 2026-09-02 physical items instead charged the buyer 5%
// on top and paid the seller the full amount; that surcharge is now 0 by default.

/** Buyer surcharge on DIGITAL listings. Default 0 — students pay list price. */
// ---------------------------------------------------------------------------
// Digital goods (question banks, study packs)
// ---------------------------------------------------------------------------
// Different economics from hand-over: no delivery, so the platform takes a
// larger cut of the sale (creator fee) and the buyer still pays list.

export const MARKETPLACE_DEFAULT_DIGITAL_BUYER_FEE_BPS = 0;
/** Platform commission taken from the creator's payout on DIGITAL listings. Default 1500 = 15%. */
export const MARKETPLACE_DEFAULT_CREATOR_FEE_BPS = 1500;

function resolveBpsEnv(raw: string | undefined | null, fallback: number): number {
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 0 || n > 10_000) return fallback;
  return n;
}

export function resolveMarketplaceDigitalBuyerFeeBps(
  raw: string | undefined | null = typeof process !== 'undefined'
    ? process.env?.MARKETPLACE_DIGITAL_BUYER_FEE_BPS
    : undefined
): number {
  return resolveBpsEnv(raw, MARKETPLACE_DEFAULT_DIGITAL_BUYER_FEE_BPS);
}

export function resolveMarketplacePhysicalCommissionBps(
  raw: string | undefined | null = typeof process !== 'undefined'
    ? process.env?.MARKETPLACE_PHYSICAL_COMMISSION_BPS
    : undefined
): number {
  return resolveBpsEnv(raw, MARKETPLACE_DEFAULT_PHYSICAL_COMMISSION_BPS);
}
export function resolveMarketplaceCreatorFeeBps(
  raw: string | undefined | null = typeof process !== 'undefined'
    ? process.env?.MARKETPLACE_CREATOR_FEE_BPS
    : undefined
): number {
  return resolveBpsEnv(raw, MARKETPLACE_DEFAULT_CREATOR_FEE_BPS);
}

// ---------------------------------------------------------------------------
// Resolving the whole fee set at once
// ---------------------------------------------------------------------------
// `resolveMarketplaceFees` is what callers should use — it reads every bps
// value from one env bag so a partially-configured environment cannot produce
// a half-old, half-new price.

export type MarketplaceResolvedFees = {
  /** true for question_bank / study_pack. */
  isDigital: boolean;
  itemAmountKobo: number;
  /** Buyer surcharge rate applied (physical = service fee; digital = digital buyer fee). */
  buyerFeeBps: number;
  /** Platform commission rate taken from the seller's payout (15% digital, 5% physical by default). */
  creatorFeeBps: number;
  buyerFeeKobo: number;
  platformFeeKobo: number;
  /** What the seller is paid out: item minus the platform commission. */
  sellerPayoutKobo: number;
  /** What the buyer is charged: item plus the buyer surcharge. */
  totalChargedKobo: number;
};

/** Digital listing kinds carry the creator-commission model. Mirrors lifecycle.isDigitalListingKind. */
const DIGITAL_KINDS = ['question_bank', 'study_pack'];

/**
 * Env source for the fee knobs. A plain record (assignable from process.env and
 * from a test's literal) — the keys read are MARKETPLACE_SERVICE_FEE_BPS,
 * MARKETPLACE_PHYSICAL_COMMISSION_BPS, MARKETPLACE_DIGITAL_BUYER_FEE_BPS and
 * MARKETPLACE_CREATOR_FEE_BPS.
 */
export type ResolveMarketplaceFeesEnv = Record<string, string | undefined>;

/**
 * The one place the fee split is decided, from four env knobs. Physical and
 * digital differ only in configuration: both charge the buyer the list price
 * (surcharges default to 0) and pay the seller the item minus a commission —
 * 5% physical, 15% digital.
 */
export function resolveMarketplaceFees(input: {
  listingKind: string | null | undefined;
  itemAmountKobo: number;
  env?: ResolveMarketplaceFeesEnv;
}): MarketplaceResolvedFees {
  const { itemAmountKobo } = input;
  if (!Number.isInteger(itemAmountKobo) || itemAmountKobo < 0) {
    throw new Error('itemAmountKobo must be a non-negative integer');
  }
  const env: ResolveMarketplaceFeesEnv =
    input.env ?? (typeof process !== 'undefined' ? (process.env as ResolveMarketplaceFeesEnv) : {});
  const isDigital =
    typeof input.listingKind === 'string' && DIGITAL_KINDS.includes(input.listingKind);

  const buyerFeeBps = isDigital
    ? resolveMarketplaceDigitalBuyerFeeBps(env.MARKETPLACE_DIGITAL_BUYER_FEE_BPS)
    : resolveMarketplaceServiceFeeBps(env.MARKETPLACE_SERVICE_FEE_BPS);
  // Both kinds now take the platform's cut out of the seller's payout; they
  // differ only in the rate. The buyer pays the list price either way.
  const creatorFeeBps = isDigital
    ? resolveMarketplaceCreatorFeeBps(env.MARKETPLACE_CREATOR_FEE_BPS)
    : resolveMarketplacePhysicalCommissionBps(env.MARKETPLACE_PHYSICAL_COMMISSION_BPS);

  const buyerFeeKobo = Math.round((itemAmountKobo * buyerFeeBps) / 10_000);
  const platformFeeKobo = Math.min(
    itemAmountKobo,
    Math.round((itemAmountKobo * creatorFeeBps) / 10_000)
  );
  return {
    isDigital,
    itemAmountKobo,
    buyerFeeBps,
    creatorFeeBps,
    buyerFeeKobo,
    platformFeeKobo,
    sellerPayoutKobo: itemAmountKobo - platformFeeKobo,
    totalChargedKobo: itemAmountKobo + buyerFeeKobo,
  };
}
