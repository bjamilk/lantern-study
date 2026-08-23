/** Default marketplace service fee: 5% (500 basis points). */
export const MARKETPLACE_DEFAULT_SERVICE_FEE_BPS = 500;

export type MarketplaceFeeBreakdown = {
  itemAmountKobo: number;
  serviceFeeKobo: number;
  totalChargeKobo: number;
  serviceFeeBps: number;
};

/** Convert Naira (may be float from DB) to integer kobo. */
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
 * Buyer-facing 5% service charge on top of item total.
 * All math in integer kobo — never use float Naira for settlement.
 */
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
// Digital listings (question banks, study packs): students pay the LIST price
// (no buyer surcharge by default) and the platform takes a 15% commission out
// of the creator's payout. Physical listings keep today's maths exactly (buyer
// pays list + 5% service fee; seller receives the full item amount).

/** Buyer surcharge on DIGITAL listings. Default 0 — students pay list price. */
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

export function resolveMarketplaceCreatorFeeBps(
  raw: string | undefined | null = typeof process !== 'undefined'
    ? process.env?.MARKETPLACE_CREATOR_FEE_BPS
    : undefined
): number {
  return resolveBpsEnv(raw, MARKETPLACE_DEFAULT_CREATOR_FEE_BPS);
}

export type MarketplaceResolvedFees = {
  /** true for question_bank / study_pack. */
  isDigital: boolean;
  itemAmountKobo: number;
  /** Buyer surcharge rate applied (physical = service fee; digital = digital buyer fee). */
  buyerFeeBps: number;
  /** Platform commission rate taken from the seller's payout (digital only; 0 for physical). */
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
 * MARKETPLACE_DIGITAL_BUYER_FEE_BPS and MARKETPLACE_CREATOR_FEE_BPS.
 */
export type ResolveMarketplaceFeesEnv = Record<string, string | undefined>;

/**
 * The one place the fee split is decided, from three env knobs. Physical and
 * digital differ only in configuration: physical charges the buyer a service
 * fee and pays the seller the full item; digital charges the buyer nothing
 * extra (by default) and pays the creator the item minus a 15% commission.
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
  const creatorFeeBps = isDigital
    ? resolveMarketplaceCreatorFeeBps(env.MARKETPLACE_CREATOR_FEE_BPS)
    : 0;

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
