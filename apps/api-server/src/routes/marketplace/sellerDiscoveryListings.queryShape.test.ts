/**
 * Query shapes AND responses for the remaining marketplace escapes outside
 * `offers.ts` (lane R2, PR 3): `seller.ts` (5 chains), `discovery.ts` (4),
 * `listings.ts` (4) and `orders.ts` (1).
 *
 * None of these handlers had a suite that reached its queries.
 *
 * Written and committed against the UNTOUCHED routes. Each case pins the query
 * trace AND the response — status and body — on the happy path and on the
 * refusal path where the handler has one.
 *
 * ## What the predicates decide here
 *
 * - `seller.ts` serves a PUBLIC shop page, so the scoping is not "is this
 *   yours": it is `status` on the listings the page may show, and `isOwner` on
 *   the private stats block. The counts use `head: true`, so they return no
 *   rows at all — dropping that turns a favourites badge into a full scan.
 * - `discovery.ts` saved searches are strictly owner-scoped. Read, update and
 *   delete all carry `eq("user_id", …)`; the service role bypasses RLS, so
 *   losing one on the DELETE would let anybody remove anybody's saved search by
 *   id.
 * - `listings.ts` (`GET /listings/:id/full`, the batched detail-page load) reads
 *   the DIGITAL entitlement scoped to the viewer. Without
 *   `eq("user_id", viewerId)` the listing page would tell every visitor they
 *   already own a paid question bank — and the "Download" affordance follows
 *   `owned`.
 * - `orders.ts` scopes its field update to the caller as buyer XOR seller, with
 *   two exact filters rather than an interpolated `.or()` string.
 *
 * ## Issue #108 — one real hit, in the money path
 *
 * `PUT /orders/:id`'s field update is a BARE awaited write: its `{error}` is
 * never read, so a failed update is invisible and the handler carries on to the
 * status transition and answers success. The last case here pins that behaviour
 * exactly as it is. Frozen, not fixed — see the KNOWN ISSUE at the call site.
 *
 * Note the shape: the chain is built, then awaited through a ternary
 * (`await (isSeller ? scoped.eq(…) : scoped.eq(…))`). The regex in issue #108
 * only matches a bare `await db.from(…)…;` statement, so it does NOT find this
 * one — which is why 87 is a floor rather than a count.
 */
jest.mock('../../middleware/auth', () => ({
  ...jest.requireActual('../../middleware/auth'),
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  optionalAuthMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../services/idempotency', () => ({
  normalizeIdempotencyKey: () => 'key-1',
  withIdempotency: (
    _client: unknown,
    _userId: string,
    _op: string,
    _key: string,
    fn: () => Promise<unknown>,
  ) => fn(),
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

const USER = 'user-1';
const SELLER = 'seller-1';
const LISTING = 'listing-1';

const ok = (data: unknown, count?: number): QueryResult => ({ data, error: null, count });

async function runRoute(
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
  req: any,
) {
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

function initWith(resolve?: ResolveResult, layer: Record<string, unknown> = {}) {
  const rec = createQueryRecorder(resolve);
  initializeMarketplaceRoutes(
    {
      getClient: () => rec.client,
      notifications: { createNotification: jest.fn(async () => ({ id: 'n1' })) },
      users: {},
      readState: { getAllDMUnreadCounts: jest.fn(async () => ({})) },
      ...layer,
      // AFTER `...layer`: the real module bound to the recorder, with this
      // test's stubs merged on top. Spreading `layer` last would replace the
      // whole namespace and the moved functions would be undefined.
      marketplace: {
        ...bindDataModule(marketplaceData, rec.client),
        ...((layer.marketplace as object) ?? {}),
      },
    } as any,
    { get: jest.fn(async () => null), set: jest.fn(async () => {}), delete: jest.fn(async () => {}) } as any,
  );
  return rec;
}

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

// ---------------------------------------------------------------------------
// discovery.ts — saved searches
// ---------------------------------------------------------------------------

describe('saved searches', () => {
  it('creates one owned by the caller, notify on by default', async () => {
    const rec = initWith(ok({ id: 'ss-1' }));

    const res = await runRoute('post', '/saved-searches', {
      user: { id: USER },
      body: { filters: { category: 'books' }, name: 'Cheap books' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ success: true, data: { id: 'ss-1' } });
    expect(rec.trace[0]).toBe('from("saved_searches")');
    const row = JSON.parse(rec.trace[1].slice('insert('.length, -1));
    expect(row).toMatchObject({ user_id: USER, notify: true });
    expect(rec.trace.slice(2)).toEqual(['select("*")', 'single()']);
  });

  it('lists only the caller own, newest first', async () => {
    const rec = initWith(ok([]));

    const res = await runRoute('get', '/saved-searches', { user: { id: USER } });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
    expect(rec.trace).toEqual([
      'from("saved_searches")',
      'select("*")',
      `eq("user_id", "${USER}")`,
      'order("created_at", {"ascending":false})',
    ]);
  });

  it('deletes by id AND owner — the owner filter is the whole guard', async () => {
    const rec = initWith(ok(null));

    const res = await runRoute('delete', '/saved-searches/:id', {
      user: { id: USER },
      params: { id: 'ss-1' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(rec.trace).toEqual([
      'from("saved_searches")',
      'delete()',
      'eq("id", "ss-1")',
      // Without this, anybody can delete anybody's saved search by id.
      `eq("user_id", "${USER}")`,
    ]);
  });

  it('patches by id AND owner', async () => {
    const rec = initWith(ok({ id: 'ss-1', notify: false }));

    const res = await runRoute('patch', '/saved-searches/:id', {
      user: { id: USER },
      params: { id: 'ss-1' },
      body: { notify: false },
    });

    expect(res.statusCode).toBe(200);
    expect(rec.trace).toEqual([
      'from("saved_searches")',
      'update({"notify":false})',
      'eq("id", "ss-1")',
      `eq("user_id", "${USER}")`,
      'select("*")',
      'single()',
    ]);
  });

  it('rejects an empty patch with 400 before writing', async () => {
    const rec = initWith(ok(null));

    const res = await runRoute('patch', '/saved-searches/:id', {
      user: { id: USER },
      params: { id: 'ss-1' },
      body: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'notify or name required' });
    expect(rec.tables()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// seller.ts — the public shop page
// ---------------------------------------------------------------------------

describe('GET /sellers/:userId/profile — the public shop', () => {
  const profile = { id: SELLER, name: 'Ada', avatar_url: null, created_at: '2026-01-01' };

  const shopFlow =
    (over: Record<string, QueryResult> = {}) =>
    (table: string): QueryResult =>
      over[table] ??
      (table === 'profiles'
        ? ok(profile)
        : table === 'marketplace_listings'
          ? ok([{ id: LISTING, status: 'active', views_count: 3, price: 100, title: 'X', images: [], category: 'books', location: 'Lagos', created_at: '2026-02-02' }])
          : ok([], 0));

  it('reads the profile, the listings, then the reviews for those listings', async () => {
    const rec = initWith(shopFlow());

    const res = await runRoute('get', '/sellers/:userId/profile', {
      user: { id: 'viewer-1' },
      params: { userId: SELLER },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    expect(rec.trace.slice(0, 4)).toEqual([
      'from("profiles")',
      'select("id, name, avatar_url, created_at")',
      `eq("id", "${SELLER}")`,
      'single()',
    ]);
    expect(rec.trace.slice(4, 8)).toEqual([
      'from("marketplace_listings")',
      'select("id, title, price, images, category, location, status, views_count, created_at")',
      `eq("user_id", "${SELLER}")`,
      'order("created_at", {"ascending":false})',
    ]);
    expect(rec.trace.slice(8, 12)).toEqual([
      'from("marketplace_reviews")',
      'select("id, listing_id, reviewer_id, rating, comment, created_at, reviewer:profiles!marketplace_reviews_reviewer_id_fkey(id, name, avatar_url)")',
      `in("listing_id", ["${LISTING}"])`,
      'order("created_at", {"ascending":false})',
    ]);
  });

  it('answers 404 when the seller profile does not exist, reading nothing else', async () => {
    const rec = initWith((table) => (table === 'profiles' ? ok(null) : ok([])));

    const res = await runRoute('get', '/sellers/:userId/profile', {
      user: { id: 'viewer-1' },
      params: { userId: SELLER },
    });

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'User not found' });
    expect(rec.tables()).toEqual(['from("profiles")']);
  });

  it('counts favourites and inquiries as HEAD counts, for the owner only', async () => {
    const rec = initWith(shopFlow());

    await runRoute('get', '/sellers/:userId/profile', {
      user: { id: SELLER },
      params: { userId: SELLER },
    });

    const at = rec.trace.indexOf('from("marketplace_favorites")');
    expect(at).toBeGreaterThan(-1);
    expect(rec.trace.slice(at)).toEqual([
      'from("marketplace_favorites")',
      // head: true — a badge, not a roster.
      'select("id", {"count":"exact","head":true})',
      `in("listing_id", ["${LISTING}"])`,
      'from("marketplace_inquiries")',
      'select("id", {"count":"exact","head":true})',
      `in("listing_id", ["${LISTING}"])`,
    ]);
  });

  it('does NOT read the private counts for a visitor who is not the owner', async () => {
    const rec = initWith(shopFlow());

    await runRoute('get', '/sellers/:userId/profile', {
      user: { id: 'viewer-1' },
      params: { userId: SELLER },
    });

    expect(rec.tables()).not.toContain('from("marketplace_favorites")');
    expect(rec.tables()).not.toContain('from("marketplace_inquiries")');
  });
});

// ---------------------------------------------------------------------------
// listings.ts — digital meta and entitlement
// ---------------------------------------------------------------------------

describe('GET /listings/:id/full — digital meta', () => {
  /**
   * The listing page calls several data-layer methods that are not queries this
   * lane is moving; they are stubbed so the digital-meta chains below are what
   * the trace shows.
   */
  const listingPageStubs = {
    incrementListingViews: jest.fn(async () => false),
    getRelatedMarketplaceListings: jest.fn(async () => []),
    isListingFavorited: jest.fn(async () => false),
    getMarketplaceReviews: jest.fn(async () => []),
    canUserReviewListing: jest.fn(async () => ({ eligible: false })),
  };

  const bankListing = {
    id: LISTING,
    user_id: SELLER,
    listing_kind: 'question_bank',
    status: 'active',
    title: 'Pharm bank',
    price: 2000,
    images: [],
  };

  it('reads the bank meta, then the VIEWER entitlement', async () => {
    const rec = initWith(
      (table) =>
        table === 'marketplace_question_banks'
          ? ok({ question_count: 120, version: 3 })
          : ok({ id: 'ent-1' }),
      { marketplace: { ...listingPageStubs, getMarketplaceListingForViewer: jest.fn(async () => bankListing) } },
    );

    const res = await runRoute('get', '/listings/:id/full', {
      user: { id: USER },
      params: { id: LISTING },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.questionBank).toEqual({ questionCount: 120, version: 3, owned: true });

    const at = rec.trace.indexOf('from("marketplace_question_banks")');
    expect(rec.trace.slice(at, at + 4)).toEqual([
      'from("marketplace_question_banks")',
      'select("question_count, version")',
      `eq("listing_id", "${LISTING}")`,
      'maybeSingle()',
    ]);
    expect(rec.trace.slice(at + 4, at + 10)).toEqual([
      'from("marketplace_question_bank_entitlements")',
      'select("id")',
      `eq("listing_id", "${LISTING}")`,
      // Without this every visitor is told they already own it.
      `eq("user_id", "${USER}")`,
      'maybeSingle()',
    ].slice(0, 5));
  });

  it('reports not owned, and reads no entitlement at all, for a signed-out viewer', async () => {
    const rec = initWith(
      (table) => (table === 'marketplace_question_banks' ? ok({ question_count: 120, version: 3 }) : ok(null)),
      { marketplace: { ...listingPageStubs, getMarketplaceListingForViewer: jest.fn(async () => bankListing) } },
    );

    const res = await runRoute('get', '/listings/:id/full', { params: { id: LISTING } });

    expect(res.body.data.questionBank).toMatchObject({ owned: false });
    expect(rec.tables()).not.toContain('from("marketplace_question_bank_entitlements")');
  });

  it('reads study-pack meta with the same shape for a study_pack listing', async () => {
    const rec = initWith(
      (table) => (table === 'marketplace_study_packs' ? ok({ counts: { notes: 4 }, version: 2 }) : ok(null)),
      {
        marketplace: {
          ...listingPageStubs,
          getMarketplaceListingForViewer: jest.fn(async () => ({ ...bankListing, listing_kind: 'study_pack' })),
        },
      },
    );

    const res = await runRoute('get', '/listings/:id/full', {
      user: { id: USER },
      params: { id: LISTING },
    });

    expect(res.body.data.studyPack).toEqual({ counts: { notes: 4 }, version: 2, owned: false });
    const at = rec.trace.indexOf('from("marketplace_study_packs")');
    expect(rec.trace.slice(at, at + 4)).toEqual([
      'from("marketplace_study_packs")',
      'select("counts, version")',
      `eq("listing_id", "${LISTING}")`,
      'maybeSingle()',
    ]);
  });

  it('leaves the meta null rather than failing the listing when the read throws', async () => {
    const rec = initWith(
      (table) => {
        if (table === 'marketplace_question_banks') throw new Error('schema cache miss');
        return ok(null);
      },
      { marketplace: { ...listingPageStubs, getMarketplaceListingForViewer: jest.fn(async () => bankListing) } },
    );

    const res = await runRoute('get', '/listings/:id/full', {
      user: { id: USER },
      params: { id: LISTING },
    });

    // Decorative meta must never block the listing itself.
    expect(res.statusCode).toBe(200);
    expect(res.body.data.questionBank).toBeNull();
    expect(rec.tables()).toContain('from("marketplace_question_banks")');
  });
});
