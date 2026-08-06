import {
  computeMarketplaceCheckoutFees,
  isMarketplacePaystackCheckoutEnabled,
  koboToNaira,
  nairaToKobo,
  resolveMarketplaceServiceFeeBps,
} from './fees';

describe('marketplace fees', () => {
  it('converts naira to kobo safely', () => {
    expect(nairaToKobo(1000)).toBe(100_000);
    expect(nairaToKobo(10.5)).toBe(1050);
    expect(koboToNaira(1050)).toBe(10.5);
  });

  it('adds 5% buyer service charge in kobo', () => {
    const fees = computeMarketplaceCheckoutFees(100_000);
    expect(fees.serviceFeeKobo).toBe(5_000);
    expect(fees.totalChargeKobo).toBe(105_000);
    expect(fees.serviceFeeBps).toBe(500);
  });

  it('rounds fee to nearest kobo', () => {
    // 333 kobo * 5% = 16.65 → 17
    expect(computeMarketplaceCheckoutFees(333).serviceFeeKobo).toBe(17);
  });

  it('rejects invalid amounts', () => {
    expect(() => computeMarketplaceCheckoutFees(-1)).toThrow();
    expect(() => computeMarketplaceCheckoutFees(10.5)).toThrow();
  });

  it('parses feature flag and fee bps', () => {
    expect(isMarketplacePaystackCheckoutEnabled('true')).toBe(true);
    expect(isMarketplacePaystackCheckoutEnabled('0')).toBe(false);
    expect(resolveMarketplaceServiceFeeBps('500')).toBe(500);
    expect(resolveMarketplaceServiceFeeBps('nope')).toBe(500);
  });
});
