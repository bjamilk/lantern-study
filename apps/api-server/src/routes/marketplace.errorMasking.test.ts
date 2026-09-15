/**
 * Masked errors: user-facing marketplace conditions used to escape the route
 * bodies as plain `new Error(...)` and get collapsed to a generic 500
 * "Something went wrong" toast by the global handler. respondMarketplaceClientError
 * surfaces the real message as a 4xx for known validation/state errors, while
 * leaving DB/internal errors to escape (so we never leak internals).
 */
import { respondMarketplaceClientError, mapMarketplaceError, respondMarketplaceError } from './marketplace';
import {
  ConcurrentIdempotentRequestTimeoutError,
  IdempotentRetryAfterFailureError,
} from '../services/idempotency';
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

  // R5a: the name-check heuristic is gone. A bare `new Error` is no longer
  // guessed to be a validation message — services say so with PublicError.
  it('does NOT surface an unmarked plain Error (the removed name-check heuristic)', () => {
    const res = fakeRes();
    expect(respondMarketplaceClientError(res, new Error('Not enough stock'))).toBe(false);
    expect(res.statusCode).toBeUndefined();
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


/**
 * F7b: the order and payment routes used to end in a bare
 * `catch { res.status(400|403).json({ error: clientErrorMessage(err) }) }`, so a
 * Postgres outage or a failed Paystack verify was reported to the buyer as their
 * own mistake and never reached 5xx alerting.
 */
describe('mapMarketplaceError', () => {
  it('surfaces a PublicError at the route\'s own fallback status', () => {
    expect(mapMarketplaceError(new PublicError('Order is closed'))).toEqual({
      status: 400,
      code: 'MARKETPLACE_REQUEST_INVALID',
      message: 'Order is closed',
    });
    // GET /orders/:id kept its 403 for a caller who is not a party to the order.
    expect(mapMarketplaceError(new PublicError('Unauthorized'), 403)).toEqual({
      status: 403,
      code: 'MARKETPLACE_FORBIDDEN',
      message: 'Unauthorized',
    });
  });

  it('does NOT surface an unmarked plain Error (the removed name-check heuristic)', () => {
    expect(mapMarketplaceError(new Error('Not enough stock'))).toBeNull();
  });

  // The exact leak the heuristic caused: idempotency's own 409s were reported
  // as 400s carrying internal prose. They carry statusCode 409, so they are now
  // mapped honestly — and their `code` distinguishes them for the client.
  //
  // UPDATED (G3 · H7): the code the error carries now reaches the wire. It used
  // to be overwritten with the per-status default, so the two idempotency
  // refusals — "retry this key" and "mint a new key" — arrived identical, and a
  // client that could not tell them apart kept hammering a dead key for the
  // full 10-minute failure TTL.
  it('maps an idempotency 409 to 409 and keeps its own code', () => {
    expect(mapMarketplaceError(new ConcurrentIdempotentRequestTimeoutError(), 400)).toMatchObject({
      status: 409,
      code: 'IDEMPOTENCY_CONCURRENT',
      retryable: true,
    });
    expect(new ConcurrentIdempotentRequestTimeoutError().code).toBe('IDEMPOTENCY_CONCURRENT');
    expect(new IdempotentRetryAfterFailureError().code).toBe('IDEMPOTENCY_PREVIOUS_FAILED');
  });

  it('honours an explicit 4xx statusCode over the fallback', () => {
    const err = Object.assign(new PublicError('Already paid'), { statusCode: 409 });
    expect(mapMarketplaceError(err, 403)).toMatchObject({
      status: 409,
      code: 'MARKETPLACE_CONFLICT',
    });
  });

  it('returns null for a DB error so the route rethrows into the 500 path', () => {
    const dbErr = Object.assign(new Error('ambiguous embedding'), {
      name: 'PostgrestError',
      code: 'PGRST201',
    });
    expect(mapMarketplaceError(dbErr, 400)).toBeNull();
    expect(mapMarketplaceError(dbErr, 403)).toBeNull();
  });

  it('returns null for a bug in a service (TypeError) and for a 5xx', () => {
    expect(mapMarketplaceError(new TypeError('x is undefined'))).toBeNull();
    const upstream = Object.assign(new Error('Paystack unavailable'), { statusCode: 502 });
    expect(mapMarketplaceError(upstream)).toBeNull();
  });

  it('respondMarketplaceError writes the mapping, or reports false so the caller rethrows', () => {
    const res = fakeRes();
    expect(respondMarketplaceError(res, new PublicError('Order is closed'), 400)).toBe(true);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      error: 'Order is closed',
      code: 'MARKETPLACE_REQUEST_INVALID',
    });

    const res2 = fakeRes();
    expect(respondMarketplaceError(res2, new TypeError('boom'), 400)).toBe(false);
    expect(res2.statusCode).toBeUndefined();
  });
});
