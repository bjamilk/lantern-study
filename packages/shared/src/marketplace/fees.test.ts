import {
  computeMarketplaceCheckoutFees,
  isMarketplacePaystackCheckoutEnabled,
  koboToNaira,
  nairaToKobo,
  resolveMarketplaceServiceFeeBps,
  resolveMarketplacePhysicalCommissionBps,
  resolveMarketplaceFees,
} from './fees';

describe('resolveMarketplaceFees', () => {
  it('physical: buyer pays the list price, Lantern keeps 5% of it, seller gets 95%', () => {
    const f = resolveMarketplaceFees({ listingKind: 'single', itemAmountKobo: 200_000, env: {} });
    expect(f).toMatchObject({
      isDigital: false,
      buyerFeeBps: 0,
      creatorFeeBps: 500,
      buyerFeeKobo: 0,
      platformFeeKobo: 10_000,
      sellerPayoutKobo: 190_000,
      totalChargedKobo: 200_000,
    });
  });

  it('physical: the old buyer surcharge can be re-enabled by env, and the commission knob is separate', () => {
    const f = resolveMarketplaceFees({
      listingKind: 'single',
      itemAmountKobo: 200_000,
      env: { MARKETPLACE_SERVICE_FEE_BPS: '500', MARKETPLACE_PHYSICAL_COMMISSION_BPS: '250' },
    });
    expect(f).toMatchObject({
      buyerFeeKobo: 10_000,
      platformFeeKobo: 5_000,
      sellerPayoutKobo: 195_000,
      totalChargedKobo: 210_000,
    });
  });

  it('digital default: buyer pays list price, platform takes 15% from the payout', () => {
    for (const kind of ['question_bank', 'study_pack']) {
      const f = resolveMarketplaceFees({ listingKind: kind, itemAmountKobo: 200_000, env: {} });
      expect(f).toMatchObject({
        isDigital: true,
        buyerFeeBps: 0,
        creatorFeeBps: 1500,
        buyerFeeKobo: 0,
        platformFeeKobo: 30_000,
        sellerPayoutKobo: 170_000,
        totalChargedKobo: 200_000,
      });
    }
  });

  it('honours env overrides for both split knobs', () => {
    const f = resolveMarketplaceFees({
      listingKind: 'study_pack',
      itemAmountKobo: 100_000,
      env: { MARKETPLACE_DIGITAL_BUYER_FEE_BPS: '300', MARKETPLACE_CREATOR_FEE_BPS: '2000' },
    });
    expect(f).toMatchObject({
      buyerFeeKobo: 3_000,
      platformFeeKobo: 20_000,
      sellerPayoutKobo: 80_000,
      totalChargedKobo: 103_000,
    });
  });

  it('the seller payout + platform fee always reconstruct the item amount', () => {
    for (const amt of [1, 99, 100, 12_345, 999_999]) {
      const f = resolveMarketplaceFees({ listingKind: 'study_pack', itemAmountKobo: amt, env: {} });
      expect(f.sellerPayoutKobo + f.platformFeeKobo).toBe(amt);
      expect(f.totalChargedKobo).toBe(amt + f.buyerFeeKobo);
    }
  });
});

describe('marketplace fees', () => {
  it('converts naira to kobo safely', () => {
    expect(nairaToKobo(1000)).toBe(100_000);
    expect(nairaToKobo(10.5)).toBe(1050);
    expect(koboToNaira(1050)).toBe(10.5);
  });

  it('computes a 5% buyer surcharge in kobo when asked for one', () => {
    const fees = computeMarketplaceCheckoutFees(100_000, 500);
    expect(fees.serviceFeeKobo).toBe(5_000);
    expect(fees.totalChargeKobo).toBe(105_000);
    expect(fees.serviceFeeBps).toBe(500);
  });

  it('rounds fee to nearest kobo', () => {
    // 333 kobo * 5% = 16.65 → 17
    expect(computeMarketplaceCheckoutFees(333, 500).serviceFeeKobo).toBe(17);
  });

  it('rejects invalid amounts', () => {
    expect(() => computeMarketplaceCheckoutFees(-1)).toThrow();
    expect(() => computeMarketplaceCheckoutFees(10.5)).toThrow();
  });

  it('parses feature flag and fee bps', () => {
    expect(isMarketplacePaystackCheckoutEnabled('true')).toBe(true);
    expect(isMarketplacePaystackCheckoutEnabled('0')).toBe(false);
    expect(resolveMarketplaceServiceFeeBps('500')).toBe(500);
    // An unparseable value falls back to the DEFAULT, which is 0 since the 5%
    // moved from the buyer's total into the seller's payout (2026-09-02).
    expect(resolveMarketplaceServiceFeeBps('nope')).toBe(0);
    expect(resolveMarketplacePhysicalCommissionBps('nope')).toBe(500);
    expect(resolveMarketplacePhysicalCommissionBps('250')).toBe(250);
  });
});

describe('buyer surcharge default', () => {
  it('computeMarketplaceCheckoutFees adds nothing unless a rate is passed', () => {
    const fees = computeMarketplaceCheckoutFees(100_000);
    expect(fees.serviceFeeKobo).toBe(0);
    expect(fees.totalChargeKobo).toBe(100_000);
  });
});
