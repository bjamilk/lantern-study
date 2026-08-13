export const MARKETPLACE_ENABLED_COUNTRIES = ['NG'] as const;
export type MarketplaceCountryCode = (typeof MARKETPLACE_ENABLED_COUNTRIES)[number];
export const MARKETPLACE_DEFAULT_COUNTRY: MarketplaceCountryCode = 'NG';
export const MARKETPLACE_DEFAULT_CURRENCY = 'NGN';

// Buyers and sellers settle payment between themselves. Lantern does not take
// payment, hold funds, or transfer money to sellers, so no copy here may imply
// that it does — an escrow promise the product does not keep is the one thing
// this file exists to prevent.
export const MARKETPLACE_COMPLIANCE_BANNER =
  'Lantern Study Marketplace is available across Nigeria. Campus or city details help with local discovery and logistics. Payment, pickup and delivery are arranged directly between buyer and seller — Lantern does not process payments or hold funds. Meet safely and only pay when you can verify the item.';

export const MARKETPLACE_CREATE_CONFIRMATION =
  'I confirm this listing is in Nigeria, its campus or city details are accurate, and the pickup or delivery terms are clear. Buyers pay me directly; Lantern does not process payment for this order.';

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
