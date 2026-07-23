/** Normalize listing price / sale_price for marketplace_listings_sale_price_check. */

export class MarketplacePricingError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'MarketplacePricingError';
  }
}

function toFiniteNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Returns values safe for insert/update under:
 * sale_price IS NULL OR (sale_price >= 0 AND (price IS NULL OR sale_price < price))
 */
export function normalizeMarketplacePricing(input: {
  price?: unknown;
  sale_price?: unknown;
  salePrice?: unknown;
}): { price: number | null; sale_price: number | null } {
  const price = toFiniteNumber(input.price);
  let salePrice = toFiniteNumber(input.sale_price ?? input.salePrice);

  if (price !== null && price < 0) {
    throw new MarketplacePricingError('Price cannot be negative.');
  }
  if (salePrice !== null && salePrice < 0) {
    throw new MarketplacePricingError('Sale price cannot be negative.');
  }
  // Empty / invalid sale fields → no sale (avoids NaN / "" leaking into Postgres).
  if (salePrice === null) {
    return { price, sale_price: null };
  }
  // Constraint is strict: sale must be lower than the regular price.
  if (price === null) {
    throw new MarketplacePricingError('Set a regular price before adding a sale price.');
  }
  if (salePrice >= price) {
    throw new MarketplacePricingError('Sale price must be lower than the regular price.');
  }
  return { price, sale_price: salePrice };
}

export function isMarketplacePricingError(error: unknown): error is MarketplacePricingError {
  return error instanceof MarketplacePricingError;
}
