/**
 * Masked errors: user-facing marketplace conditions used to escape the route
 * bodies as plain `new Error(...)` and get collapsed to a generic 500
 * "Something went wrong" toast by the global handler. respondMarketplaceClientError
 * surfaces the real message as a 4xx for known validation/state errors, while
 * leaving DB/internal errors to escape (so we never leak internals).
 */
import { respondMarketplaceClientError } from './marketplace';
import { PublicError } from '../utils/safeError';
import { MarketplaceOrdersService } from '../services/marketplaceOrders';
import { MarketplaceCouponsService } from '../services/marketplaceCoupons';

function fakeRes() {
  const out: any = { statusCode: undefined, body: undefined };
  out.status = (code: number) => {
    out.statusCode = code;
    return out;
  };
  out.json = (body: unknown) => {
    out.body = body;
    return out;
  };
  return out;
}

function couponDb(result: { data: unknown; error: unknown }) {
  const chain: any = {};
  const self = () => chain;
  chain.select = self;
  chain.eq = self;
  chain.maybeSingle = async () => result;
  return { from: () => chain };
}

describe('respondMarketplaceClientError classification', () => {
  it('surfaces a PublicError as 400 with its message', () => {
    const res = fakeRes();
    expect(respondMarketplaceClientError(res, new PublicError('Coupon has expired'))).toBe(true);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Coupon has expired' });
  });

  it('surfaces a plain validation Error as 400 with its message', () => {
    const res = fakeRes();
    expect(respondMarketplaceClientError(res, new Error('Not enough stock'))).toBe(true);
    expect(res.body).toEqual({ success: false, error: 'Not enough stock' });
  });

  it('honours an explicit 4xx statusCode on the error', () => {
    const res = fakeRes();
    const err = Object.assign(new Error('Nope'), { statusCode: 409 });
    expect(respondMarketplaceClientError(res, err)).toBe(true);
    expect(res.statusCode).toBe(409);
  });

  it('does NOT surface a Postgrest/DB error (has a code)', () => {
    const res = fakeRes();
    const dbErr = Object.assign(new Error('duplicate key'), {
      name: 'PostgrestError',
      code: '23505',
    });
    expect(respondMarketplaceClientError(res, dbErr)).toBe(false);
    expect(res.statusCode).toBeUndefined();
  });

  it('does NOT surface an unexpected internal error (e.g. TypeError)', () => {
    const res = fakeRes();
    expect(respondMarketplaceClientError(res, new TypeError('x is undefined'))).toBe(false);
    expect(res.statusCode).toBeUndefined();
  });
});

describe('real buy-now out-of-stock condition surfaces as 400', () => {
  it('assertListingInStock throws an out-of-stock message that the helper surfaces', () => {
    let thrown: unknown;
    try {
      // Private guard, no `this` dependency — the real out-of-stock throw.
      (MarketplaceOrdersService.prototype as any).assertListingInStock(
        { status: 'active', quantity: 0 },
        1,
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(PublicError);

    const res = fakeRes();
    expect(respondMarketplaceClientError(res, thrown)).toBe(true);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'This listing is out of stock' });
  });
});

describe('real invalid-coupon condition surfaces as 400', () => {
  it('validateForListing throws "Invalid coupon code" that the helper surfaces', async () => {
    const svc = new MarketplaceCouponsService({
      getClient: () => couponDb({ data: null, error: null }),
    } as any);

    let thrown: unknown;
    try {
      await svc.validateForListing('SAVE10', { id: 'l1', user_id: 'seller-1' } as any, 'buyer-1');
    } catch (e) {
      thrown = e;
    }

    const res = fakeRes();
    expect(respondMarketplaceClientError(res, thrown)).toBe(true);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Invalid coupon code' });
  });
});
