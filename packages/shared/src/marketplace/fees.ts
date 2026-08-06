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
