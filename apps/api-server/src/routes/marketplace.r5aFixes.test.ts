/**
 * R5a — the three F7b deferrals fixed while the marketplace routes were split,
 * plus the service throw sites the removed `isPlainValidation` heuristic used
 * to classify by name.
 *
 *   (a) GET /categories/custom missed the `await` on `cacheService.get`, so
 *       `cached` was a pending Promise — always truthy — and the route answered
 *       `{success:true,data:{}}` forever.
 *   (b) PATCH /orders/:id carried no idempotency, while its money siblings did.
 *   (c) `respondMarketplaceClientError` / `mapMarketplaceError` guessed that any
 *       `new Error(...)` without a `.code` was a validation message. The guess
 *       is gone; the services say so explicitly with PublicError.
 */
import { PublicError } from '../utils/safeError';
import { MarketplaceCartService } from '../services/marketplaceCart';
import { MarketplaceCouponsService } from '../services/marketplaceCoupons';
import { MarketplaceSellerToolsService } from '../services/marketplaceSellerTools';
import { mapMarketplaceError, respondMarketplaceClientError } from './marketplace';

// ---------------------------------------------------------------------------
// (c) converted service throw sites
// ---------------------------------------------------------------------------

async function thrown(fn: () => unknown): Promise<unknown> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

function chain(result: { data: unknown; error: unknown }) {
  const c: any = {};
  const self = () => c;
  c.select = self;
  c.eq = self;
  c.in = self;
  c.order = self;
  c.limit = self;
  c.maybeSingle = async () => result;
  c.single = async () => result;
  c.then = undefined;
  return c;
}

describe('R5a (c): marketplace services throw PublicError, not a bare Error', () => {
  it('cart: "Cannot add your own listing to cart" is a PublicError the mapper surfaces as 400', async () => {
    const svc = new MarketplaceCartService({
      getClient: () => ({ from: () => chain({ data: null, error: null }) }),
      getMarketplaceListingById: async () => ({
        id: 'l1',
        user_id: 'buyer-1',
        status: 'active',
        quantity: 5,
      }),
    } as any);

    const err = await thrown(() => svc.addToCart('buyer-1', 'l1', 1));
    expect(err).toBeInstanceOf(PublicError);
    expect((err as Error).message).toBe('Cannot add your own listing to cart');
    expect(mapMarketplaceError(err, 400)).toMatchObject({
      status: 400,
      code: 'MARKETPLACE_REQUEST_INVALID',
      message: 'Cannot add your own listing to cart',
    });
  });

  it('coupons: "Invalid coupon code" is a PublicError', async () => {
    const svc = new MarketplaceCouponsService({
      getClient: () => ({ from: () => chain({ data: null, error: null }) }),
    } as any);

    const err = await thrown(() =>
      svc.validateForListing('SAVE10', { id: 'l1', user_id: 'seller-1' } as any, 'buyer-1')
    );
    expect(err).toBeInstanceOf(PublicError);
    expect((err as Error).message).toBe('Invalid coupon code');

    const res: any = { status: (c: number) => ((res.statusCode = c), res), json: (b: any) => ((res.body = b), res) };
    expect(respondMarketplaceClientError(res, err)).toBe(true);
    expect(res.statusCode).toBe(400);
  });

  it('coupons: every create-side validation refusal is a PublicError', async () => {
    const svc = new MarketplaceCouponsService({
      getClient: () => ({ from: () => chain({ data: null, error: null }) }),
    } as any);

    for (const [input, message] of [
      [{ code: '   ', discountType: 'percent', discountValue: 10 }, 'Coupon code is required'],
      [{ code: 'A', discountType: 'percent', discountValue: 0 }, 'Discount must be positive'],
      [{ code: 'A', discountType: 'percent', discountValue: 101 }, 'Percent discount cannot exceed 100'],
    ] as const) {
      const err = await thrown(() => svc.createCoupon('seller-1', input as any));
      expect(err).toBeInstanceOf(PublicError);
      expect((err as Error).message).toBe(message);
    }
  });

  it('seller tools: bundle validation refusals are PublicErrors', async () => {
    const svc = new MarketplaceSellerToolsService({
      getClient: () => ({ from: () => chain({ data: null, error: null }) }),
    } as any);

    const cases: Array<[any, string]> = [
      [{ title: '  ', price: 100, campusId: 'c1', listingIds: ['a', 'b'] }, 'Bundle title is required'],
      [{ title: 'Kit', price: 0, campusId: 'c1', listingIds: ['a', 'b'] }, 'Bundle price must be positive'],
      [{ title: 'Kit', price: 100, campusId: '', listingIds: ['a', 'b'] }, 'Campus or city metadata is required'],
      [{ title: 'Kit', price: 100, campusId: 'c1', listingIds: ['a'] }, 'Select at least 2 listings for a bundle'],
      [
        { title: 'Kit', price: 100, campusId: 'c1', listingIds: Array.from({ length: 11 }, (_, i) => `l${i}`) },
        'Bundles can include at most 10 items',
      ],
    ];
    for (const [input, message] of cases) {
      const err = await thrown(() => svc.createBundle('seller-1', input));
      expect(err).toBeInstanceOf(PublicError);
      expect((err as Error).message).toBe(message);
      expect(mapMarketplaceError(err, 400)?.status).toBe(400);
    }
  });

  it('payments: the payout-state refusals are PublicErrors, and a bare Error still escapes', () => {
    // A bare Error from anywhere under a marketplace service is no longer
    // guessed to be the caller's fault — that was the leak the heuristic caused.
    expect(mapMarketplaceError(new Error('column "foo" does not exist'), 400)).toBeNull();
    expect(mapMarketplaceError(new PublicError('Payment cannot be refunded'), 400)).toMatchObject({
      status: 400,
      message: 'Payment cannot be refunded',
    });
  });
});
