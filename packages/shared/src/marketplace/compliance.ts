export const MARKETPLACE_ENABLED_COUNTRIES = ['NG'] as const;
export type MarketplaceCountryCode = (typeof MARKETPLACE_ENABLED_COUNTRIES)[number];
export const MARKETPLACE_DEFAULT_COUNTRY: MarketplaceCountryCode = 'NG';
export const MARKETPLACE_DEFAULT_CURRENCY = 'NGN';

export const MARKETPLACE_COMPLIANCE_BANNER =
  'Lantern Study Marketplace is for Nigerian campus communities. Meet on campus; payments are arranged directly between students.';

export const MARKETPLACE_CREATE_CONFIRMATION =
  'I confirm this listing is for on-campus pickup in Nigeria and complies with campus marketplace rules.';

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
