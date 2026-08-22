jest.mock('../services/cache', () => ({
  cacheService: {
    deletePattern: jest.fn(),
    delete: jest.fn(),
    cached: async (_key: string, fn: () => Promise<unknown>) => fn(),
    invalidateUserCache: jest.fn(),
  },
}));

jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

type TableResult = { data?: any; count?: number | null; error?: any };

let tables: Record<string, TableResult> = {};
const capturedFilters: Array<{ table: string; method: string; args: any[] }> = [];

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const result = () => tables[table] ?? { data: null, count: 0, error: null };
      const builder: any = new Proxy(
        {},
        {
          get: (_t, prop) => {
            // PostgREST builders are thenables; awaiting one runs the query.
            if (prop === 'then') {
              return (resolve: (v: any) => void) => resolve(result());
            }
            if (prop === 'maybeSingle' || prop === 'single') {
              return async () => result();
            }
            return (...args: any[]) => {
              capturedFilters.push({ table, method: String(prop), args });
              return builder;
            };
          },
        }
      );
      return builder;
    },
  }),
}));

import { SupabaseService } from './supabase';

/**
 * Badge stats used to be incremented on events and never reconciled, so they
 * drifted both ways — a swallowed increment undercounted permanently, and
 * re-submitting a test result counted it twice. On the account that surfaced
 * this, testsCompleted read 11 against 13 real tests while perfectScoreTests
 * read 3 against 2.
 *
 * recomputeDerivedUserStats recounts from the source rows instead. These tests
 * pin what it counts, and — just as importantly — what it refuses to guess at.
 */
const service = () =>
  new SupabaseService({
    url: 'https://example.supabase.co',
    serviceRoleKey: 'test-key',
  } as any);

const session = (startTime: string, score: number | null) => ({
  start_time: startTime,
  test_results: score === null ? null : [{ score }],
});

beforeEach(() => {
  tables = {};
  capturedFilters.length = 0;
});

describe('recomputeDerivedUserStats', () => {
  it('counts completed tests and grades them by score', async () => {
    tables.test_sessions = {
      data: [
        session('2026-01-01T00:00:00Z', 100),
        session('2026-01-02T00:00:00Z', 88),
        session('2026-01-03T00:00:00Z', 40),
        session('2026-01-04T00:00:00Z', 100),
      ],
      error: null,
    };
    tables.messages = { count: 47, data: { upvotes: 12 }, error: null };
    tables.groups = {
      data: [{ admin_ids: ['u1'] }, { admin_ids: ['u1'] }, { admin_ids: ['u1', 'u9'] }, { admin_ids: ['u1'] }],
      error: null,
    };

    const stats = await service().recomputeDerivedUserStats('u1');

    expect(stats).toMatchObject({
      testsCompleted: 4,
      highScoreTests: 3, // 100, 88, 100
      perfectScoreTests: 2,
      questionsCreated: 47,
      groupsCreated: 4,
      questionUpvotesMax: 12,
    });
  });

  it('deduplicates sessions sharing a start time, matching the dashboard', async () => {
    // A double-submit can leave two rows for one sitting; the dashboard dedupes
    // by start time, so the badge count has to agree with what the user sees.
    tables.test_sessions = {
      data: [
        session('2026-07-12T12:40:25.645Z', 63),
        session('2026-07-12T12:40:25.645Z', 63),
        session('2026-07-13T09:00:00.000Z', 90),
      ],
      error: null,
    };

    const stats = await service().recomputeDerivedUserStats('u1');
    expect(stats.testsCompleted).toBe(2);
    expect(stats.highScoreTests).toBe(1);
  });

  it('only counts sessions that are completed', async () => {
    await service().recomputeDerivedUserStats('u1');
    const sessionFilters = capturedFilters.filter(f => f.table === 'test_sessions');
    expect(sessionFilters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'eq', args: ['user_id', 'u1'] }),
        expect.objectContaining({ method: 'eq', args: ['status', 'completed'] }),
      ])
    );
  });

  it('counts questions the user authored, and their best upvote total', async () => {
    tables.test_sessions = { data: [], error: null };
    tables.messages = { count: 3, data: { upvotes: 25 }, error: null };

    const stats = await service().recomputeDerivedUserStats('u1');
    expect(stats.questionsCreated).toBe(3);
    expect(stats.questionUpvotesMax).toBe(25);

    const messageFilters = capturedFilters.filter(f => f.table === 'messages');
    expect(messageFilters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'eq', args: ['sender_id', 'u1'] }),
        expect.objectContaining({ method: 'eq', args: ['type', 'QUESTION'] }),
      ])
    );
  });

  it('counts only groups the user created, not ones they were made admin of', async () => {
    tables.test_sessions = { data: [], error: null };
    tables.groups = {
      data: [
        { admin_ids: ['u1'] }, // created by u1
        { admin_ids: ['u1', 'u2'] }, // created by u1, co-admin added later
        { admin_ids: ['u2', 'u1'] }, // created by someone else; u1 promoted
      ],
      error: null,
    };

    const stats = await service().recomputeDerivedUserStats('u1');
    expect(stats.groupsCreated).toBe(2);

    // Containment, not an `admin_ids->>0` filter: supabase-js URL-encodes column
    // names, which stops PostgREST reading the arrow syntax as a JSON path.
    expect(capturedFilters.filter(f => f.table === 'groups')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'contains', args: ['admin_ids', ['u1']] }),
      ])
    );
  });

  it('omits metrics it cannot derive, so stored values survive', async () => {
    tables.test_sessions = { data: [], error: null };
    const stats = await service().recomputeDerivedUserStats('u1');

    // gamesWon has no source query yet. Returning 0 for it would wipe real
    // progress when merged over the stored stats.
    expect(stats).not.toHaveProperty('gamesWon');
  });

  describe('marketplace counters', () => {
    // Before these had a source query the MARKETPLACE_SELLER, TRUSTED_SELLER
    // and OFFER_MAKER badges could never be earned: the recompute omitted the
    // metrics, and the event-time increments they relied on were never wired.
    it('derives listingsCreated, listingsSold, fiveStarReviews and offersMade', async () => {
      tables.test_sessions = { data: [], error: null };
      // Both marketplace_listings queries see the same stub: the head count
      // feeds listingsCreated, the row ids feed the sold set.
      tables.marketplace_listings = { count: 3, data: [{ id: 'l1' }, { id: 'l2' }], error: null };
      tables.marketplace_orders = { data: [{ listing_id: 'l2' }, { listing_id: 'l3' }], error: null };
      tables.marketplace_reviews = { count: 2, data: null, error: null };
      tables.marketplace_offers = { count: 4, data: null, error: null };

      const stats = await service().recomputeDerivedUserStats('u1');

      expect(stats).toMatchObject({
        listingsCreated: 3,
        // l1, l2 (marked sold) ∪ l2, l3 (completed orders) — l2 counted once.
        listingsSold: 3,
        fiveStarReviews: 2,
        offersMade: 4,
      });
    });

    it('reports zero for a seller with no marketplace activity', async () => {
      tables.test_sessions = { data: [], error: null };
      const stats = await service().recomputeDerivedUserStats('u1');
      expect(stats).toMatchObject({ listingsCreated: 0, listingsSold: 0, fiveStarReviews: 0, offersMade: 0 });
    });

    it('scopes every query to the user in the right role', async () => {
      tables.test_sessions = { data: [], error: null };
      await service().recomputeDerivedUserStats('u1');

      const filters = (table: string) => capturedFilters.filter(f => f.table === table);

      expect(filters('marketplace_listings')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ method: 'eq', args: ['user_id', 'u1'] }),
          expect.objectContaining({ method: 'eq', args: ['status', 'sold'] }),
        ])
      );
      expect(filters('marketplace_orders')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ method: 'eq', args: ['seller_id', 'u1'] }),
          expect.objectContaining({ method: 'eq', args: ['status', 'completed'] }),
        ])
      );
      // Reviews have no seller column: the listing is inner-joined and the
      // owner filter applied through it.
      expect(filters('marketplace_reviews')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: 'select',
            args: [expect.stringMatching(/marketplace_listings!inner\(user_id\)/), expect.objectContaining({ count: 'exact', head: true })],
          }),
          expect.objectContaining({ method: 'eq', args: ['rating', 5] }),
          expect.objectContaining({ method: 'eq', args: ['marketplace_listings.user_id', 'u1'] }),
        ])
      );
      // Only buyers create offer rows (seller counters update in place), so
      // buyer_id is "who made the offer".
      expect(filters('marketplace_offers')).toEqual(
        expect.arrayContaining([expect.objectContaining({ method: 'eq', args: ['buyer_id', 'u1'] })])
      );
    });

    it('leaves a marketplace metric unset when its query fails, without losing the others', async () => {
      tables.test_sessions = { data: [], error: null };
      tables.marketplace_listings = { count: 5, data: [{ id: 'l1' }], error: null };
      tables.marketplace_orders = { data: null, error: { message: 'orders boom' } };
      tables.marketplace_reviews = { count: null, data: null, error: { message: 'reviews boom' } };
      tables.marketplace_offers = { count: 7, data: null, error: null };

      const stats = await service().recomputeDerivedUserStats('u1');

      expect(stats.listingsCreated).toBe(5);
      // listingsSold is a union of two reads; if either fails the partial
      // answer would be an undercount, so it is left for the stored value.
      expect(stats).not.toHaveProperty('listingsSold');
      expect(stats).not.toHaveProperty('fiveStarReviews');
      expect(stats.offersMade).toBe(7);
    });
  });

  it('leaves test counts alone when the query fails rather than zeroing them', async () => {
    tables.test_sessions = { data: null, error: { message: 'boom' } };
    tables.messages = { count: 9, data: { upvotes: 1 }, error: null };

    const stats = await service().recomputeDerivedUserStats('u1');

    // A failed read must not be mistaken for "no tests" — that would undo the
    // very drift this is meant to repair.
    expect(stats).not.toHaveProperty('testsCompleted');
    expect(stats).not.toHaveProperty('highScoreTests');
    expect(stats).not.toHaveProperty('perfectScoreTests');
    expect(stats.questionsCreated).toBe(9);
  });

  it('handles a completed session that has no result row', async () => {
    tables.test_sessions = {
      data: [session('2026-01-01T00:00:00Z', null), session('2026-01-02T00:00:00Z', 95)],
      error: null,
    };

    const stats = await service().recomputeDerivedUserStats('u1');
    expect(stats.testsCompleted).toBe(2);
    expect(stats.highScoreTests).toBe(1);
    expect(stats.perfectScoreTests).toBe(0);
  });

  it('reports zero upvotes when the user has never posted a question', async () => {
    tables.test_sessions = { data: [], error: null };
    tables.messages = { count: 0, data: null, error: null };

    const stats = await service().recomputeDerivedUserStats('u1');
    expect(stats.questionsCreated).toBe(0);
    expect(stats.questionUpvotesMax).toBe(0);
  });
});
