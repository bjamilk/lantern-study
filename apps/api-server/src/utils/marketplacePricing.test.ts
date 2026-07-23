import { normalizeMarketplacePricing, MarketplacePricingError } from './marketplacePricing';

describe('normalizeMarketplacePricing', () => {
  it('allows price-only listings', () => {
    expect(normalizeMarketplacePricing({ price: 2500 })).toEqual({
      price: 2500,
      sale_price: null,
    });
  });

  it('clears blank sale price', () => {
    expect(normalizeMarketplacePricing({ price: 2500, sale_price: '' })).toEqual({
      price: 2500,
      sale_price: null,
    });
  });

  it('accepts a lower sale price', () => {
    expect(normalizeMarketplacePricing({ price: 2500, salePrice: 2000 })).toEqual({
      price: 2500,
      sale_price: 2000,
    });
  });

  it('rejects sale price equal to price', () => {
    expect(() => normalizeMarketplacePricing({ price: 2500, sale_price: 2500 })).toThrow(
      MarketplacePricingError
    );
  });

  it('rejects sale price above price', () => {
    expect(() => normalizeMarketplacePricing({ price: 1000, sale_price: 1200 })).toThrow(
      /lower than the asking price/i
    );
  });
});
