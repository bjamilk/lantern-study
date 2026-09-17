/**
 * Query shapes AND responses for `routes/marketplace/offers.ts` (lane R2, PR 3).
 *
 * Thirteen chains — twelve `.from()` and one RPC — built inline in a file that
 * negotiates and concludes a SALE. `marketplace.offers.test.ts` covers the
 * expiry guard and the order-attachment payload; `marketplace.r5aFixes` covers a
 * couple of error shapes. Neither pins the queries, and most refusal paths here
 * had no trace assertion at all.
 *
 * Written and committed against the UNTOUCHED route, so it freezes what the
 * route did rather than describing what the extraction produced.
 *
 * ## Because this moves money, each case pins three things
 *
 *   1. the query trace — table, columns, filters, modifiers, in order;
 *   2. the response — status and body, on the happy path AND on every refusal
 *      the handler has (not a party to the offer, no longer pending, expired,
 *      digital listing, bad action);
 *   3. for handlers that write more than once, the ORDER of the writes.
 *
 * ## The conditional updates ARE the concurrency control
 *
 * `decline` and `withdraw` update `eq("id", id).eq("status", "pending")` and
 * treat a zero-row result as 409. That second predicate is the whole of the
 * double-action race guard: drop it and two tabs can both "decline", or a
 * decline can land on an already-accepted offer and strand a paid order. The
 * same shape guards the lazy expiry. Both are asserted literally.
 *
 * ## Ownership: what is scoped in SQL, and what is not
 *
 * Four reads here fetch by row id ALONE and are checked in JavaScript
 * afterwards. That is the existing design, frozen as-is, and each is named in
 * the pull request body:
 *
 *   - `GET /offers/:id`'s fetch — the route compares `buyer_id`/`seller_id` and
 *     answers 404 (not 403) so a stranger cannot probe which offer ids exist;
 *   - the counter-offer read-back, by an id the RPC itself just returned;
 *   - the accepted-offer read-back, inside the idempotency callback, after
 *     `finalizeOfferAcceptSale` has already authorized;
 *   - `attachOrdersToOffers`, which reads orders for a list of offer ids and
 *     then drops every row where the requester is neither buyer nor seller —
 *     the filter is in JS, not in the query, so the function keeps taking
 *     `requesterId` as a required parameter to make that obvious.
 */
jest.mock('../../middleware/auth', () => ({
  ...jest.requireActual('../../middleware/auth'),
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  optionalAuthMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../services/idempotency', () => ({
  normalizeIdempotencyKey: () => null,
  withIdempotency: (
    _client: unknown,
    _userId: string,
    _op: string,
    _key: string,
    fn: () => Promise<unknown>,
  ) => fn(),
}));

jest.mock('../../services/marketplacePayments', () => ({
  marketplacePaystackEnabled: () => false,
  getMarketplacePaymentsService: () => ({}),
}));

import router, { initializeMarketplaceRoutes } from './index';
import { routeLayers } from './routeLayers';
import {
  createQueryRecorder,
  bindDataModule,
  type QueryResult,
  type ResolveResult,
} from '../../testSupport/queryRecorder';
import * as marketplaceData from '../../services/data/marketplace';

const BUYER = 'buyer-1';
const SELLER = 'seller-1';
const LISTING = 'listing-1';
const OFFER = 'offer-1';
const HOUR = 60 * 60 * 1000;
const LIVE_UNTIL = new Date(Date.now() + 24 * HOUR).toISOString();
const EXPIRED_AT = new Date(Date.now() - 3 * HOUR).toISOString();

const ok = (data: unknown): QueryResult => ({ data, error: null });

const pendingOffer = (over: Record<string, unknown> = {}) => ({
  id: OFFER,
  buyer_id: BUYER,
  seller_id: SELLER,
  listing_id: LISTING,
  amount: 5000,
  status: 'pending',
  proposed_by: 'buyer',
  parent_offer_id: null,
  expires_at: LIVE_UNTIL,
  listing: { id: LISTING, title: 'Calculus textbook', price: 8000 },
  ...over,
});

/**
 * The marketplace surface is ten sub-routers under one index, so a route layer
 * lives a level down; `routeLayers` walks it the way Express does. The route
 * body is the last handler on the layer.
 */
async function runRoute(method: 'get' | 'post' | 'put', path: string, req: any) {
  const layer = routeLayers(router).find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method],
  );
  if (!layer) throw new Error(`route ${method.toUpperCase()} ${path} not found`);
  const handlers = layer.route.stack.map((s: any) => s.handle);
  const handler = handlers[handlers.length - 1] as (req: any, res: any, next: any) => void;

  const res: any = { statusCode: 200, body: undefined };
  await new Promise<void>((resolve, reject) => {
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (body: unknown) => {
      res.body = body;
      resolve();
      return res;
    };
    handler(
      { params: {}, query: {}, body: {}, headers: {}, runIdempotent: (fn: any) => fn(), ...req },
      res,
      reject,
    );
    setTimeout(() => reject(new Error('route never responded')), 2000).unref?.();
  });
  return res;
}

/**
 * The namespace is the REAL data module bound to the recording client, the way
 * `data/index.ts` binds it to the live one, with the per-test stubs on top.
 * `overrides` supplies the marketplace methods the route used BEFORE this lane
 * (`getMarketplaceListingById`, `finalizeOfferAcceptSale`, …).
 */
function initWith(resolve?: ResolveResult, overrides: Record<string, unknown> = {}) {
  const rec = createQueryRecorder(resolve);
  initializeMarketplaceRoutes(
    {
      getClient: () => rec.client,
      marketplace: { ...bindDataModule(marketplaceData, rec.client), ...overrides },
      notifications: { createNotification: jest.fn(async () => ({ id: 'n1' })) },
      users: { getAuthUserEmail: jest.fn(async () => 'buyer@example.com') },
      readState: {},
    } as any,
    { get: jest.fn(async () => null), set: jest.fn(async () => {}), delete: jest.fn(async () => {}) } as any,
  );
  return rec;
}

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('GET /offers — the caller own offers, by role', () => {
  it('scopes to buyer_id by default', async () => {
    const rec = initWith(ok([]));

    const res = await runRoute('get', '/offers', { user: { id: BUYER } });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
    expect(rec.trace).toEqual([
      'from("marketplace_offers")',
      'select("*, listing:marketplace_listings(id, title, price, images, status, category), buyer:profiles!marketplace_offers_buyer_id_fkey(id, name, avatar_url), seller:profiles!marketplace_offers_seller_id_fkey(id, name, avatar_url)")',
      `eq("buyer_id", "${BUYER}")`,
      'order("created_at", {"ascending":false})',
    ]);
  });

  it('scopes to seller_id when the caller asks for the seller view', async () => {
    const rec = initWith(ok([]));

    await runRoute('get', '/offers', { user: { id: SELLER }, query: { role: 'seller' } });

    expect(rec.trace[2]).toBe(`eq("seller_id", "${SELLER}")`);
  });

  it('attaches the order for each offer, reading orders by OFFER ID alone', async () => {
    const offer = pendingOffer({ status: 'accepted' });
    const rec = initWith((table) =>
      table === 'marketplace_offers'
        ? ok([offer])
        : ok([
            { id: 'order-1', status: 'paid', payment_id: 'pay-1', offer_id: OFFER, buyer_id: BUYER, seller_id: SELLER },
          ]),
    );

    const res = await runRoute('get', '/offers', { user: { id: BUYER } });

    expect(res.body.data[0].order).toEqual({ id: 'order-1', status: 'paid', paymentId: 'pay-1' });
    const at = rec.trace.indexOf('from("marketplace_orders")');
    expect(rec.trace.slice(at)).toEqual([
      'from("marketplace_orders")',
      // buyer_id and seller_id are SELECTED, not filtered: the requester check
      // happens in JS on the rows. Named as an unscoped lookup in the PR body.
      'select("id, status, payment_id, offer_id, buyer_id, seller_id")',
      `in("offer_id", ["${OFFER}"])`,
    ]);
  });

  it('hides an order from someone who is neither buyer nor seller on it', async () => {
    const rec = initWith((table) =>
      table === 'marketplace_offers'
        ? ok([pendingOffer({ status: 'accepted' })])
        : ok([
            { id: 'order-1', status: 'paid', payment_id: 'pay-1', offer_id: OFFER, buyer_id: 'someone-else', seller_id: 'other' },
          ]),
    );

    const res = await runRoute('get', '/offers', { user: { id: BUYER } });

    expect(res.body.data[0].order).toBeNull();
    expect(rec.tables()).toContain('from("marketplace_orders")');
  });
});

describe('PUT /offers/:id — fetch and authorization', () => {
  it('fetches the offer BY ID ALONE, then answers 404 to a stranger', async () => {
    const rec = initWith(ok(pendingOffer()));

    const res = await runRoute('put', '/offers/:id', {
      user: { id: 'stranger' },
      params: { id: OFFER },
      body: { action: 'decline' },
    });

    // 404, not 403: a 403 would confirm the offer id exists.
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Offer not found' });
    expect(rec.trace).toEqual([
      'from("marketplace_offers")',
      'select("*, listing:marketplace_listings(id, title, price)")',
      `eq("id", "${OFFER}")`,
      'single()',
    ]);
  });

  it('answers 404 when the offer does not exist, and writes nothing', async () => {
    const rec = initWith(ok(null));

    const res = await runRoute('put', '/offers/:id', {
      user: { id: BUYER },
      params: { id: OFFER },
      body: { action: 'decline' },
    });

    expect(res.statusCode).toBe(404);
    expect(rec.tables()).toEqual(['from("marketplace_offers")']);
  });

  it('rejects an unknown action with 400 before reading anything', async () => {
    const rec = initWith(ok(pendingOffer()));

    const res = await runRoute('put', '/offers/:id', {
      user: { id: BUYER },
      params: { id: OFFER },
      body: { action: 'haggle' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      error: 'Invalid action. Must be accept, decline, counter, or withdraw',
    });
    expect(rec.tables()).toEqual([]);
  });
});

describe('PUT /offers/:id — decline and withdraw', () => {
  /** nth 0 = the fetch, nth 1 = the conditional update. */
  const flow = (updated: unknown) => (_t: string, nth: number): QueryResult =>
    nth === 0 ? ok(pendingOffer()) : ok(updated);

  it('declines with a conditional update — the status predicate is the race guard', async () => {
    const declined = pendingOffer({ status: 'declined' });
    const rec = initWith(flow(declined));

    const res = await runRoute('put', '/offers/:id', {
      user: { id: SELLER },
      params: { id: OFFER },
      body: { action: 'decline' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    // slice(4, 10): the update chain. The response then attaches orders, which
    // `GET /offers` already covers.
    expect(rec.trace.slice(4, 10)).toEqual([
      'from("marketplace_offers")',
      'update({"status":"declined"})',
      `eq("id", "${OFFER}")`,
      // Without this, two tabs can both decline, or a decline can land on an
      // offer that was already accepted and paid for.
      'eq("status", "pending")',
      'select("*")',
      'maybeSingle()',
    ]);
  });

  it('withdraws with the same shape and the withdrawn status', async () => {
    const rec = initWith(flow(pendingOffer({ status: 'withdrawn' })));

    const res = await runRoute('put', '/offers/:id', {
      user: { id: BUYER },
      params: { id: OFFER },
      body: { action: 'withdraw' },
    });

    expect(res.statusCode).toBe(200);
    expect(rec.trace[5]).toBe('update({"status":"withdrawn"})');
  });

  it('answers 409 when the conditional update matched no row', async () => {
    const rec = initWith(flow(null));

    const res = await runRoute('put', '/offers/:id', {
      user: { id: SELLER },
      params: { id: OFFER },
      body: { action: 'decline' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      success: false,
      error: 'Cannot decline an offer that is no longer pending',
    });
    // The update was attempted; it simply matched nothing, and the handler
    // stopped there rather than attaching orders to a refusal.
    expect(rec.tables()).toEqual([
      'from("marketplace_offers")',
      'from("marketplace_offers")',
    ]);
  });
});

describe('PUT /offers/:id — the lazy expiry write', () => {
  it('refuses accept on an expired offer and marks it expired, conditionally', async () => {
    const rec = initWith((_t, nth) => (nth === 0 ? ok(pendingOffer({ expires_at: EXPIRED_AT })) : ok(null)));

    const res = await runRoute('put', '/offers/:id', {
      user: { id: SELLER },
      params: { id: OFFER },
      body: { action: 'accept' },
    });

    expect(res.statusCode).toBe(409);
    expect(String(res.body.error)).toMatch(/expired/i);

    // The expiry write is best-effort, and conditional on the row still being
    // pending, so it cannot overwrite a status somebody else just set.
    expect(rec.trace.slice(4)).toEqual([
      'from("marketplace_offers")',
      'update({"status":"expired"})',
      `eq("id", "${OFFER}")`,
      'eq("status", "pending")',
    ]);
  });

  it('lets decline through on an expired offer — it is terminal and harmless', async () => {
    const rec = initWith((_t, nth) =>
      nth === 0 ? ok(pendingOffer({ expires_at: EXPIRED_AT })) : ok(pendingOffer({ status: 'declined' })),
    );

    const res = await runRoute('put', '/offers/:id', {
      user: { id: SELLER },
      params: { id: OFFER },
      body: { action: 'decline' },
    });

    expect(res.statusCode).toBe(200);
  });
});

describe('POST /offers — creating one', () => {
  const listing = { id: LISTING, user_id: SELLER, price: 8000, status: 'active', listing_kind: 'physical' };

  it('inserts a pending offer with a 48-hour expiry, owned by the caller', async () => {
    const rec = initWith(ok(pendingOffer()), {
      getMarketplaceListingById: jest.fn(async () => listing),
    });

    const res = await runRoute('post', '/offers', {
      user: { id: BUYER },
      body: { listingId: LISTING, amount: 5000, message: 'Would you take this?' },
    });

    expect(res.statusCode).toBe(201);
    expect(rec.trace[0]).toBe('from("marketplace_offers")');
    const row = JSON.parse(rec.trace[1].slice('insert('.length, -1));
    expect(row).toMatchObject({
      listing_id: LISTING,
      buyer_id: BUYER,
      seller_id: SELLER,
      amount: 5000,
      status: 'pending',
      proposed_by: 'buyer',
    });
    expect(Date.parse(row.expires_at) - Date.now()).toBeGreaterThan(47 * HOUR);
    expect(rec.trace.slice(2)).toEqual(['select("*")', 'single()']);
  });

  it('on a 23505, looks for the caller OWN pending offer on that listing', async () => {
    const rec = initWith(
      (_t, nth) =>
        nth === 0
          ? { data: null, error: { code: '23505', message: 'duplicate key' } }
          : ok(pendingOffer()),
      { getMarketplaceListingById: jest.fn(async () => listing) },
    );

    const res = await runRoute('post', '/offers', {
      user: { id: BUYER },
      body: { listingId: LISTING, amount: 5000 },
    });

    expect(res.statusCode).toBe(200);
    expect(rec.trace.slice(4)).toEqual([
      'from("marketplace_offers")',
      'select("*")',
      `eq("listing_id", "${LISTING}")`,
      // Scoped to the caller: the one-pending-per-buyer slot is theirs.
      `eq("buyer_id", "${BUYER}")`,
      'eq("status", "pending")',
      'maybeSingle()',
    ]);
  });

  it('expires a DEAD pending offer and retries the insert, in that order', async () => {
    const rec = initWith(
      (_t, nth) => {
        if (nth === 0) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        if (nth === 1) return ok(pendingOffer({ expires_at: EXPIRED_AT }));
        if (nth === 2) return ok(null); // the expiry write
        return ok(pendingOffer());
      },
      { getMarketplaceListingById: jest.fn(async () => listing) },
    );

    const res = await runRoute('post', '/offers', {
      user: { id: BUYER },
      body: { listingId: LISTING, amount: 5000 },
    });

    expect(res.statusCode).toBe(201);
    // insert -> read existing -> expire it -> insert again. The order matters:
    // retrying before the expiry would hit the same unique index again.
    const writes = rec.trace.filter((c) => c.startsWith('insert(') || c.startsWith('update('));
    expect(writes).toHaveLength(3);
    expect(writes[1]).toBe('update({"status":"expired"})');
  });

  it('refuses an offer on a digital listing with 400, before any query', async () => {
    const rec = initWith(ok(null), {
      getMarketplaceListingById: jest.fn(async () => ({ ...listing, listing_kind: 'question_bank' })),
    });

    const res = await runRoute('post', '/offers', {
      user: { id: BUYER },
      body: { listingId: LISTING, amount: 5000 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      error: 'Digital products are fixed-price — use Buy Now or the free download',
    });
    expect(rec.tables()).toEqual([]);
  });
});

describe('PUT /offers/:id — counter', () => {
  it('goes through the atomic RPC, then reads the child back by its returned id', async () => {
    const rec = initWith((table, nth) => {
      if (nth === 0) return ok(pendingOffer());
      if (table === 'rpc:marketplace_counter_offer') return ok([{ counter_offer_id: 'offer-2' }]);
      return ok(pendingOffer({ id: 'offer-2', amount: 6500, proposed_by: 'seller' }));
    });

    const res = await runRoute('put', '/offers/:id', {
      user: { id: SELLER },
      params: { id: OFFER },
      body: { action: 'counter', counterAmount: 6500 },
    });

    expect(res.statusCode).toBe(200);
    expect(rec.trace[4]).toBe(
      `rpc("marketplace_counter_offer", {"p_offer_id":"${OFFER}","p_actor_id":"${SELLER}","p_counter_amount":6500})`,
    );
    // The read-back is by the id the RPC just returned — unscoped by design.
    // slice(5, 9): the response then attaches orders, covered by GET /offers.
    expect(rec.trace.slice(5, 9)).toEqual([
      'from("marketplace_offers")',
      'select("*")',
      'eq("id", "offer-2")',
      'single()',
    ]);
  });

  it('answers 409 when the RPC says the offer is no longer pending', async () => {
    const rec = initWith((table, nth) => {
      if (nth === 0) return ok(pendingOffer());
      if (table === 'rpc:marketplace_counter_offer') {
        return { data: null, error: { message: 'offer is no longer pending' } };
      }
      return ok(null);
    });

    const res = await runRoute('put', '/offers/:id', {
      user: { id: SELLER },
      params: { id: OFFER },
      body: { action: 'counter', counterAmount: 6500 },
    });

    expect(res.statusCode).toBe(409);
    // No read-back after a failed RPC.
    expect(rec.tables()).toEqual(['from("marketplace_offers")']);
  });

  it('requires a positive counterAmount, before the RPC', async () => {
    const rec = initWith(ok(pendingOffer()));

    const res = await runRoute('put', '/offers/:id', {
      user: { id: SELLER },
      params: { id: OFFER },
      body: { action: 'counter', counterAmount: 0 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      error: 'counterAmount is required for counter offers',
    });
    expect(rec.trace.some((c) => c.startsWith('rpc('))).toBe(false);
  });
});

describe('GET /listings/:id/offers — the seller view', () => {
  it('lists offers for a listing the caller owns', async () => {
    const rec = initWith(ok([]), {
      getMarketplaceListingById: jest.fn(async () => ({ id: LISTING, user_id: SELLER })),
    });

    const res = await runRoute('get', '/listings/:id/offers', {
      user: { id: SELLER },
      params: { id: LISTING },
    });

    expect(res.statusCode).toBe(200);
    expect(rec.trace).toEqual([
      'from("marketplace_offers")',
      'select("*, buyer:profiles!marketplace_offers_buyer_id_fkey(id, name, avatar_url)")',
      `eq("listing_id", "${LISTING}")`,
      'order("created_at", {"ascending":false})',
    ]);
  });

  it('answers 403 and reads nothing for someone who does not own the listing', async () => {
    const rec = initWith(ok([]), {
      getMarketplaceListingById: jest.fn(async () => ({ id: LISTING, user_id: SELLER })),
    });

    const res = await runRoute('get', '/listings/:id/offers', {
      user: { id: 'stranger' },
      params: { id: LISTING },
    });

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ success: false, error: 'Only the listing owner can view offers' });
    expect(rec.tables()).toEqual([]);
  });
});
