export const MARKETPLACE_ENABLED_COUNTRIES = ['NG'] as const;
export type MarketplaceCountryCode = (typeof MARKETPLACE_ENABLED_COUNTRIES)[number];
export const MARKETPLACE_DEFAULT_COUNTRY: MarketplaceCountryCode = 'NG';
export const MARKETPLACE_DEFAULT_CURRENCY = 'NGN';

export const MARKETPLACE_COMPLIANCE_BANNER =
  'Lantern Study Marketplace is available across Nigeria. Campus or city details help with local discovery and logistics. Checkout is processed in-app via Paystack (item total + 5% service charge). Funds are released to the seller after you confirm receipt.';

export const MARKETPLACE_CREATE_CONFIRMATION =
  'I confirm this listing is in Nigeria, its campus or city details are accurate, the pickup or delivery terms are clear, and I have (or will add) a payout bank account to receive Paystack transfers.';

export const MARKETPLACE_SERVICE_FEE_DISCLOSURE =
  'A 5% Lantern service charge is added at checkout. The seller receives the listing amount after you confirm delivery; Lantern retains the service charge.';

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
