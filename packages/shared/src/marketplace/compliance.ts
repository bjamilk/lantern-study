export const MARKETPLACE_ENABLED_COUNTRIES = ['NG'] as const;
export type MarketplaceCountryCode = (typeof MARKETPLACE_ENABLED_COUNTRIES)[number];
export const MARKETPLACE_DEFAULT_COUNTRY: MarketplaceCountryCode = 'NG';
export const MARKETPLACE_DEFAULT_CURRENCY = 'NGN';

// Two copy modes. The Paystack strings describe in-app escrow and must ONLY be
// shown when the server reports paystackEnabled: true (/marketplace/payments/config);
// showing them while checkout is the direct "arrange between users" fallback
// promises money-handling that does not happen. Clients should default to the
// DIRECT strings until the config confirms otherwise.
export const MARKETPLACE_COMPLIANCE_BANNER =
  'Lantern Study Marketplace is available across Nigeria. Campus or city details help with local discovery and logistics. Buyers pay the listed price; Lantern keeps a 5% marketplace fee from the seller’s payout once delivery is confirmed.';

export const MARKETPLACE_COMPLIANCE_BANNER_DIRECT =
  'Lantern Study Marketplace is available across Nigeria. Campus or city details help with local discovery and logistics. In-app checkout is not yet available: payment, pickup and delivery are arranged directly between buyer and seller. Meet safely and only pay when you can verify the item.';

export const MARKETPLACE_CREATE_CONFIRMATION =
  'I confirm this listing is in Nigeria, its campus or city details are accurate, the pickup or delivery terms are clear, and I have (or will add) a payout bank account to receive Paystack transfers.';

export const MARKETPLACE_CREATE_CONFIRMATION_DIRECT =
  'I confirm this listing is in Nigeria, its campus or city details are accurate, and the pickup or delivery terms are clear. Buyers pay me directly; Lantern does not process payment for this order.';

export const MARKETPLACE_SERVICE_FEE_DISCLOSURE =
  'You pay the listed price — no service charge is added. After you confirm delivery the seller receives the amount minus Lantern’s 5% marketplace fee.';

/**
 * Digital products (study packs, question banks) price differently: the buyer
 * pays the listed price and Lantern's commission comes out of the creator's
 * payout. Show this instead of MARKETPLACE_SERVICE_FEE_DISCLOSURE for them.
 */
export const MARKETPLACE_DIGITAL_FEE_DISCLOSURE =
  'You pay the listed price — no service charge is added. Lantern keeps a commission from the creator’s payout, and your copy is delivered instantly.';

/** Banner copy for the current payments mode. Pass null/undefined (unknown) to get the conservative direct-arrangement copy. */
export function marketplaceComplianceBanner(paystackEnabled?: boolean | null): string {
  return paystackEnabled ? MARKETPLACE_COMPLIANCE_BANNER : MARKETPLACE_COMPLIANCE_BANNER_DIRECT;
}

/** Listing-creation confirmation copy for the current payments mode. */
export function marketplaceCreateConfirmation(paystackEnabled?: boolean | null): string {
  return paystackEnabled ? MARKETPLACE_CREATE_CONFIRMATION : MARKETPLACE_CREATE_CONFIRMATION_DIRECT;
}

export function isMarketplaceCountryEnabled(countryCode?: string | null): boolean {
  if (!countryCode) return false;
  return (MARKETPLACE_ENABLED_COUNTRIES as readonly string[]).includes(countryCode.toUpperCase());
}

export function resolveMarketplaceCountryFromHeaders(
  cfIpCountry?: string | null
): MarketplaceCountryCode | null {
  if (!cfIpCountry) return null;
  const code = cfIpCountry.toUpperCase();
  return isMarketplaceCountryEnabled(code) ? (code as MarketplaceCountryCode) : null;
}
