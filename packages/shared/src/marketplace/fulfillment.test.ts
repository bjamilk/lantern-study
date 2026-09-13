import {
  checkoutRequiresAddress,
  fulfillmentChipLabels,
  fulfillmentOptionsForListing,
  groupLinesBySeller,
  shippingFeeNaira,
} from './fulfillment';
import { quoteCheckout } from './checkoutQuote';
import { formatMarketplaceAddressLine, validateMarketplaceAddress } from './addresses';
import { shopDepartmentDiscs, SHOP_HOME_COPY } from './shopHome';

describe('fulfillment options', () => {
  it('always offers meetup for physical listings and adds shipping when the seller ships', () => {
    expect(fulfillmentOptionsForListing({ listing_kind: 'single' })).toEqual(['campus_meetup']);
    expect(
      fulfillmentChipLabels(
        { listing_kind: 'single' },
        { hall_dropoff_enabled: true, shipping_enabled: true },
      ),
    ).toEqual(['Meetup', 'Hall dropoff', 'Ships']);
  });

  it('keeps digital listings instant-only', () => {
    expect(fulfillmentOptionsForListing({ listing_kind: 'study_pack' })).toEqual(['digital']);
  });
});

describe('shippingFeeNaira', () => {
  it('is free over the threshold and zero when shipping is off', () => {
    expect(shippingFeeNaira({ shipping_enabled: false, shipping_fee_naira: 1500 }, 4000)).toBe(0);
    expect(
      shippingFeeNaira(
        { shipping_enabled: true, shipping_fee_naira: 1500, shipping_free_over_naira: 8000 },
        4000,
      ),
    ).toBe(1500);
    expect(
      shippingFeeNaira(
        { shipping_enabled: true, shipping_fee_naira: 1500, shipping_free_over_naira: 8000 },
        8000,
      ),
    ).toBe(0);
  });
});

describe('groupLinesBySeller', () => {
  it('groups cart lines by seller and sums item totals', () => {
    const groups = groupLinesBySeller([
      { listingId: 'a', sellerId: 's1', quantity: 1, itemTotalNaira: 2000, source: 1 },
      { listingId: 'b', sellerId: 's2', quantity: 1, itemTotalNaira: 1000, source: 2 },
      { listingId: 'c', sellerId: 's1', quantity: 2, itemTotalNaira: 3000, source: 3 },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.sellerId).toBe('s1');
    expect(groups[0]?.itemTotalNaira).toBe(5000);
    expect(groups[0]?.lines).toHaveLength(2);
    expect(groups[1].sellerId).toBe('s2');
  });
});

describe('quoteCheckout', () => {
  it('adds shipping only on ship groups and flags a required address', () => {
    const quote = quoteCheckout([
      {
        sellerId: 's1',
        itemTotalNaira: 4000,
        fulfillmentMode: 'shipping',
        prefs: { shipping_enabled: true, shipping_fee_naira: 1500 },
      },
      {
        sellerId: 's2',
        itemTotalNaira: 2000,
        fulfillmentMode: 'campus_meetup',
        prefs: { shipping_enabled: true, shipping_fee_naira: 1500 },
      },
    ]);
    expect(quote.itemTotalNaira).toBe(6000);
    expect(quote.shippingTotalNaira).toBe(1500);
    expect(quote.totalNaira).toBe(7500);
    expect(quote.totalChargeKobo).toBe(750000);
    expect(quote.requiresAddress).toBe(true);
    expect(checkoutRequiresAddress(['campus_meetup'])).toBe(false);
  });
});

describe('addresses', () => {
  it('rejects a missing street and formats a saved address', () => {
    expect(validateMarketplaceAddress({ recipient_name: 'Ada', phone: '08012345678', city: 'Nsukka' }).ok).toBe(
      false,
    );
    const ok = validateMarketplaceAddress({
      recipient_name: 'Ada',
      phone: '0801 234 5678',
      city: 'Nsukka',
      line1: 'Room 12, Block B',
      hall: 'Bello Hall',
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.phone).toBe('08012345678');
      expect(formatMarketplaceAddressLine(ok.value)).toContain('Bello Hall');
    }
  });
});

describe('shop home', () => {
  it('exposes nine department discs and storefront copy', () => {
    expect(shopDepartmentDiscs()).toHaveLength(9);
    expect(SHOP_HOME_COPY.title).toBe('Shop');
    expect(shopDepartmentDiscs()[0]?.feature).toBeTruthy();
  });
});
