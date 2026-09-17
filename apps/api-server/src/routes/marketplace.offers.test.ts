/**
 * Two offer holes closed together:
 *
 * 1. `marketplace_offers.expires_at` was written everywhere (48h default, set on
 *    create and inside the counter RPC) and both clients promise "expires in 48
 *    hours" — but PUT /offers/:id only ever checked `status !== 'pending'`, so a
 *    dead offer was still acceptable at its stale price via a direct API call.
 * 2. Accepting an offer creates an order (marketplace_orders.offer_id), but the
 *    offer payload never mentioned it, so an accepted offer was a dead end for
 *    the buyer. Every offer now carries `order: { id, status, paymentId } | null`,
 *    non-null only for a party to that order.
 */
jest.mock('../services/idempotency', () => ({
  normalizeIdempotencyKey: () => null,
  withIdempotency: (
    _client: unknown,
    _userId: string,
    _op: string,
    _key: string,
    fn: () => Promise<unknown>,
  ) => fn(),
}));

jest.mock('../services/marketplacePayments', () => ({
  marketplacePaystackEnabled: () => false,
  getMarketplacePaymentsService: () => ({}),
}));

jest.mock('../services/marketplaceOrders', () => ({
  ...jest.requireActual('../services/marketplaceOrders'),
  invalidateSellerAnalyticsCache: jest.fn(async () => {}),
}));

import router, {
  attachOrdersToOffers,
  initializeMarketplaceRoutes,
  offerExpiryConflict,
} from './marketplace';
import * as marketplaceData from '../services/data/marketplace';
import { bindDataModule } from '../services/data/testStub';
import { routeLayers } from './marketplace/routeLayers';

const HOUR = 60 * 60 * 1000;
// Pinned clock for the pure helper (exact message text); the route tests use
// real time relative to now, since the route reads Date.now() itself.
const PINNED_NOW = Date.parse('2026-08-20T12:00:00.000Z');
const PINNED_EXPIRED_AT = new Date(PINNED_NOW - 3 * HOUR).toISOString();
const PINNED_LIVE_UNTIL = new Date(PINNED_NOW + 24 * HOUR).toISOString();
const EXPIRED_AT = new Date(Date.now() - 3 * HOUR).toISOString();
const LIVE_UNTIL = new Date(Date.now() + 24 * HOUR).toISOString();

type Op = { fn: string; args: any[] };
type Call = { table: string; ops: Op[]; terminal: string };

/** Minimal supabase-js chain stub: records the chain, defers the result to `resolve`. */
function fakeDb(resolve: (call: Call) => any) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const ops: Op[] = [];
      const chain: any = {};
      for (const fn of ['select', 'eq', 'in', 'order', 'update', 'insert', 'limit']) {
        chain[fn] = (...args: any[]) => {
          ops.push({ fn, args });
          return chain;
        };
      }
      const settle = (terminal: string) => {
        const call: Call = { table, ops, terminal };
        calls.push(call);
        return Promise.resolve(resolve(call) ?? { data: null, error: null });
      };
      chain.single = () => settle('single');
      chain.maybeSingle = () => settle('maybeSingle');
      chain.then = (onOk: any, onErr: any) => settle('then').then(onOk, onErr);
      return chain;
    },
  };
  return { client, calls };
}

/**
 * asyncHandler swallows its own promise, so awaiting the handler proves nothing
 * — wait on the response instead. The route body is the last handler on the
 * layer (after authMiddleware).
 */
async function runRoute(method: 'get' | 'put', path: string, req: any) {
  const layer = routeLayers(router).find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method],
  );
  if (!layer) throw new Error(`route ${method.toUpperCase()} ${path} not found`);
  const handlers = layer.route.stack.map((s: any) => s.handle);
  const handler = handlers[handlers.length - 1] as (req: any, res: any, next: any) => void;

  const res: any = { statusCode: 200, body: undefined, nextError: undefined };
  const settled = new Promise<void>((resolve, reject) => {
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (body: unknown) => {
      res.body = body;
      resolve();
      return res;
    };
    handler(req, res, (err: unknown) => {
      res.nextError = err;
      reject(err);
    });
    setTimeout(() => reject(new Error('route never responded')), 2000).unref?.();
  });

  await settled;
  return res;
}

const pendingOffer = (overrides: Record<string, unknown> = {}) => ({
  id: 'offer-1',
  buyer_id: 'buyer-1',
  seller_id: 'seller-1',
  listing_id: 'listing-1',
  amount: 5000,
  status: 'pending',
  proposed_by: 'buyer',
  parent_offer_id: null,
  expires_at: LIVE_UNTIL,
  listing: { id: 'listing-1', title: 'Calculus textbook', price: 8000 },
  ...overrides,
});

function initWith(resolve: (call: Call) => any, extra: Record<string, unknown> = {}) {
  const { client, calls } = fakeDb(resolve);
  // The family is injected with the DATA LAYER now: the same stubs, regrouped
  // under the domain namespace that owns each one.
  const supabase: any = {
    getClient: () => client,
    legacyService: {},
    notifications: { createNotification: jest.fn(async () => ({ id: 'n1' })) },
    // Every per-test stub in this file is a marketplace method.
    // The offer queries moved into `services/data/marketplace.ts` (lane R2),
    // so the route reaches them through the layer. This suite drives a FAKE
    // POSTGREST CLIENT rather than stubbing those functions, so it binds the
    // real module to that client — the chains it asserts on are unchanged.
    marketplace: { ...bindDataModule(marketplaceData, client), ...extra },
  };
  initializeMarketplaceRoutes(supabase, { get: async () => null, set: async () => {} } as any);
  return { supabase, calls };
}

describe('offerExpiryConflict', () => {
  it('refuses accept on a pending offer whose 48h window closed', () => {
    const conflict = offerExpiryConflict(
      { status: 'pending', expires_at: PINNED_EXPIRED_AT },
      'accept',
      PINNED_NOW,
    );
    expect(conflict?.status).toBe(409);
    expect(conflict?.error).toBe(
      'This offer expired on 20 Aug 2026 and can no longer be accepted.',
    );
  });

  it('refuses counter on an expired offer', () => {
    expect(
      offerExpiryConflict(
        { status: 'pending', expires_at: PINNED_EXPIRED_AT },
        'counter',
        PINNED_NOW,
      )?.error,
    ).toBe('This offer expired on 20 Aug 2026 and can no longer be countered.');
  });

  it('lets decline and withdraw through — they are terminal and harmless', () => {
    const expired = { status: 'pending', expires_at: PINNED_EXPIRED_AT };
    expect(offerExpiryConflict(expired, 'decline', PINNED_NOW)).toBeNull();
    expect(offerExpiryConflict(expired, 'withdraw', PINNED_NOW)).toBeNull();
  });

  it('leaves a live offer alone', () => {
    expect(
      offerExpiryConflict({ status: 'pending', expires_at: PINNED_LIVE_UNTIL }, 'accept', PINNED_NOW),
    ).toBeNull();
  });

  it('ignores offers that are not pending, or carry no/garbage expiry', () => {
    expect(
      offerExpiryConflict({ status: 'accepted', expires_at: PINNED_EXPIRED_AT }, 'accept', PINNED_NOW),
    ).toBeNull();
    expect(offerExpiryConflict({ status: 'pending', expires_at: null }, 'accept', PINNED_NOW))
      .toBeNull();
    expect(offerExpiryConflict({ status: 'pending', expires_at: 'not-a-date' }, 'accept', PINNED_NOW))
      .toBeNull();
  });
});

describe('PUT /offers/:id expiry guard', () => {
  it('rejects accept on an expired pending offer and lazily marks it expired', async () => {
    const finalizeOfferAcceptSale = jest.fn(async () => ({ orderId: 'order-1' }));
    const { calls } = initWith(
      (call) => {
        if (call.table === 'marketplace_offers' && call.terminal === 'single') {
          return { data: pendingOffer({ expires_at: EXPIRED_AT }), error: null };
        }
        return { data: null, error: null };
      },
      { finalizeOfferAcceptSale },
    );

    const res = await runRoute('put', '/offers/:id', {
      user: { id: 'seller-1' },
      params: { id: 'offer-1' },
      body: { action: 'accept' },
      headers: {},
    });

    expect(res.statusCode).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(
      /^This offer expired on .+ and can no longer be accepted\.$/,
    );
    expect(finalizeOfferAcceptSale).not.toHaveBeenCalled();

    const lazyExpire = calls.find((c) => c.ops.some((op) => op.fn === 'update'));
    expect(lazyExpire?.ops).toEqual([
      { fn: 'update', args: [{ status: 'expired' }] },
      { fn: 'eq', args: ['id', 'offer-1'] },
      { fn: 'eq', args: ['status', 'pending'] },
    ]);
  });

  it('still accepts a live pending offer and returns its order', async () => {
    const finalizeOfferAcceptSale = jest.fn(async () => ({ orderId: 'order-1' }));
    initWith(
      (call) => {
        if (call.table === 'marketplace_offers' && call.terminal === 'single') {
          return { data: pendingOffer(), error: null };
        }
        if (call.table === 'marketplace_offers' && call.terminal === 'maybeSingle') {
          return { data: pendingOffer({ status: 'accepted' }), error: null };
        }
        if (call.table === 'marketplace_orders') {
          return {
            data: [
              {
                id: 'order-1',
                status: 'awaiting_payment',
                payment_id: 'pay-1',
                offer_id: 'offer-1',
                buyer_id: 'buyer-1',
                seller_id: 'seller-1',
              },
            ],
            error: null,
          };
        }
        return { data: null, error: null };
      },
      { finalizeOfferAcceptSale },
    );

    const res = await runRoute('put', '/offers/:id', {
      user: { id: 'seller-1' },
      params: { id: 'offer-1' },
      body: { action: 'accept' },
      headers: {},
    });

    expect(res.statusCode).toBe(200);
    expect(finalizeOfferAcceptSale).toHaveBeenCalledWith('offer-1', 'seller-1');
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('accepted');
    expect(res.body.data.orderId).toBe('order-1');
    expect(res.body.data.order).toEqual({
      id: 'order-1',
      status: 'awaiting_payment',
      paymentId: 'pay-1',
    });
  });
});

describe('attachOrdersToOffers', () => {
  it('resolves every offer in one batched lookup', async () => {
    const { calls } = initWith(() => ({
      data: [
        {
          id: 'order-1',
          status: 'awaiting_payment',
          payment_id: 'pay-1',
          offer_id: 'offer-1',
          buyer_id: 'buyer-1',
          seller_id: 'seller-1',
        },
      ],
      error: null,
    }));

    const attached = await attachOrdersToOffers(
      [{ id: 'offer-1' }, { id: 'offer-2' }],
      'buyer-1',
    );

    expect(attached[0].order).toEqual({
      id: 'order-1',
      status: 'awaiting_payment',
      paymentId: 'pay-1',
    });
    expect(attached[1].order).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0].ops).toContainEqual({ fn: 'in', args: ['offer_id', ['offer-1', 'offer-2']] });
  });

  it('never leaks the order to someone who is not a party to it', async () => {
    initWith(() => ({
      data: [
        {
          id: 'order-1',
          status: 'paid',
          payment_id: null,
          offer_id: 'offer-1',
          buyer_id: 'buyer-1',
          seller_id: 'seller-1',
        },
      ],
      error: null,
    }));

    const [offer] = await attachOrdersToOffers([{ id: 'offer-1' }], 'stranger-9');
    expect(offer.order).toBeNull();
  });

  it('degrades to null rather than failing the list when the lookup errors', async () => {
    initWith(() => ({ data: null, error: { code: '42P01', message: 'boom' } }));
    const [offer] = await attachOrdersToOffers([{ id: 'offer-1' }], 'buyer-1');
    expect(offer.order).toBeNull();
  });
});

describe('GET /offers', () => {
  it('carries the order on each offer for the requesting party', async () => {
    initWith((call) => {
      if (call.table === 'marketplace_offers') {
        return {
          data: [pendingOffer({ status: 'accepted' }), pendingOffer({ id: 'offer-2' })],
          error: null,
        };
      }
      return {
        data: [
          {
            id: 'order-1',
            status: 'pending_payment',
            payment_id: 'pay-1',
            offer_id: 'offer-1',
            buyer_id: 'buyer-1',
            seller_id: 'seller-1',
          },
        ],
        error: null,
      };
    });

    const res = await runRoute('get', '/offers', {
      user: { id: 'buyer-1' },
      query: { role: 'buyer' },
    });

    expect(res.body.data[0].order).toEqual({
      id: 'order-1',
      status: 'pending_payment',
      paymentId: 'pay-1',
    });
    expect(res.body.data[1].order).toBeNull();
  });
});
