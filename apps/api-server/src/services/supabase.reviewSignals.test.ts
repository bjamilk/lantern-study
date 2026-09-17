/**
 * Read-time review signals (verified purchase + helpful votes), the vote
 * writer, and the rating-sort browse fallback. All of these must degrade
 * gracefully while the 20260828160000 migration has not been applied: the
 * votes table and rating columns may simply not exist yet, and a browse or
 * review read must never fail because of that.
 */
/**
 * HARNESS (monolith lane M3, Phase B): the first two describes used to drive
 * `SupabaseService.prototype.<m>.call(self, …)` and now call the data module
 * that owns each body, with the same stand-in passed as the `deps` literal —
 * which is what the facade's inline arrows read off `this` anyway. The third
 * describe moved onto a real `createDataLayer(...)` in Phase A. Every `it`
 * title, every `expect` and every fixture is byte-identical.
 */
import { createDataLayer } from "./data";
import * as marketplaceData from "./data/marketplace";

type ChainResult = { data?: unknown; error?: unknown; count?: number | null };

/** Minimal PostgREST chain: builders return self; awaiting resolves the result. */
function chain(result: ChainResult) {
  const api: any = {};
  const self = () => api;
  for (const method of [
    "select",
    "eq",
    "neq",
    "in",
    "or",
    "ilike",
    "gte",
    "lte",
    "limit",
    "order",
    "range",
    "upsert",
    "delete",
  ]) {
    api[method] = self;
  }
  api.single = async () => result;
  api.maybeSingle = async () => result;
  api.then = (resolve: (value: ChainResult) => unknown) =>
    Promise.resolve({ data: null, error: null, count: null, ...result }).then(resolve);
  return api;
}

/** Per-table FIFO of results so one table can answer differently per call. */
function queuedFrom(tables: Record<string, ChainResult[]>) {
  return (table: string) => {
    const queue = tables[table];
    if (!queue || queue.length === 0) return chain({ data: [], error: null });
    return chain(queue.length > 1 ? (queue.shift() as ChainResult) : queue[0]);
  };
}

/**
 * The rating-column circuit breaker as the facade held it: a per-instance
 * timestamp plus the two accessors that read and set it. The accessors used to
 * be borrowed off `SupabaseService.prototype`; these are the same three lines,
 * and the layer's own copy (`createRatingColumnCircuitBreaker`) is what the
 * third describe below exercises.
 */
function withRatingGuards(self: any) {
  self.ratingColumnsBrokenUntil = 0;
  self.ratingColumnsAvailable = function () {
    return Date.now() >= this.ratingColumnsBrokenUntil;
  };
  self.isMissingRatingColumn = marketplaceData.isMissingRatingColumn;
  self.noteRatingColumnsMissing = function () {
    this.ratingColumnsBrokenUntil = Date.now() + 10 * 60 * 1000;
  };
  return self;
}

const REVIEW_ROWS = [
  {
    id: "rev-1",
    listing_id: "listing-1",
    reviewer_id: "buyer-1",
    rating: 5,
    comment: "great",
    created_at: "2026-08-01T00:00:00Z",
    profiles: { id: "buyer-1", name: "Buyer One" },
  },
  {
    id: "rev-2",
    listing_id: "listing-1",
    reviewer_id: "buyer-2",
    rating: 3,
    comment: null,
    created_at: "2026-08-02T00:00:00Z",
    profiles: { id: "buyer-2", name: "Buyer Two" },
  },
];

describe("getMarketplaceReviews signals", () => {
  const call = (self: any, viewerId?: string) =>
    marketplaceData.getMarketplaceReviews(
      self.supabase,
      self,
      "listing-1",
      viewerId,
    );

  it("attaches helpful counts, viewer state and verified-purchase flags", async () => {
    const self = {
      attachMarketplaceReviewSignals: function (
        lid: string,
        reviews: any[],
        viewerId?: string,
      ) {
        return marketplaceData.attachMarketplaceReviewSignals(
          (this as any).supabase,
          lid,
          reviews,
          viewerId,
        );
      },
      supabase: {
        from: queuedFrom({
          marketplace_reviews: [{ data: REVIEW_ROWS, error: null }],
          marketplace_review_votes: [
            {
              data: [
                { review_id: "rev-1", voter_id: "buyer-2" },
                { review_id: "rev-1", voter_id: "viewer-9" },
              ],
              error: null,
            },
          ],
          marketplace_orders: [{ data: [{ buyer_id: "buyer-1" }], error: null }],
          marketplace_question_bank_entitlements: [{ data: [], error: null }],
          marketplace_inquiries: [{ data: [{ buyer_id: "buyer-2" }], error: null }],
        }),
      },
    };

    const reviews = await call(self, "viewer-9");
    expect(reviews).toHaveLength(2);
    const [first, second] = reviews;
    expect(first).toMatchObject({
      id: "rev-1",
      verifiedPurchase: true,
      helpfulCount: 2,
      viewerMarkedHelpful: true,
    });
    expect(second).toMatchObject({
      id: "rev-2",
      verifiedPurchase: true, // purchased inquiry proof
      helpfulCount: 0,
      viewerMarkedHelpful: false,
    });
  });

  it("omits helpful fields entirely when the votes table is missing", async () => {
    const self = {
      attachMarketplaceReviewSignals: function (
        lid: string,
        reviews: any[],
        viewerId?: string,
      ) {
        return marketplaceData.attachMarketplaceReviewSignals(
          (this as any).supabase,
          lid,
          reviews,
          viewerId,
        );
      },
      supabase: {
        from: queuedFrom({
          marketplace_reviews: [{ data: REVIEW_ROWS, error: null }],
          marketplace_review_votes: [
            { data: null, error: { code: "42P01", message: "missing" } },
          ],
          marketplace_orders: [{ data: [], error: null }],
          marketplace_question_bank_entitlements: [{ data: [], error: null }],
          marketplace_inquiries: [{ data: [], error: null }],
        }),
      },
    };

    const reviews = await call(self);
    expect(reviews).toHaveLength(2);
    expect(reviews[0].helpfulCount).toBeUndefined();
    expect(reviews[0].viewerMarkedHelpful).toBeUndefined();
    expect(reviews[0].verifiedPurchase).toBe(false);
  });

  it("still returns plain reviews when every signal lookup fails", async () => {
    const boom = { code: "500", message: "boom" };
    const self = {
      attachMarketplaceReviewSignals: function (
        lid: string,
        reviews: any[],
        viewerId?: string,
      ) {
        return marketplaceData.attachMarketplaceReviewSignals(
          (this as any).supabase,
          lid,
          reviews,
          viewerId,
        );
      },
      supabase: {
        from: queuedFrom({
          marketplace_reviews: [{ data: REVIEW_ROWS, error: null }],
          marketplace_review_votes: [{ data: null, error: boom }],
          marketplace_orders: [{ data: null, error: boom }],
          marketplace_question_bank_entitlements: [{ data: null, error: boom }],
          marketplace_inquiries: [{ data: null, error: boom }],
        }),
      },
    };

    const reviews = await call(self);
    expect(reviews).toHaveLength(2);
    expect(reviews[0].id).toBe("rev-1");
  });
});

describe("setMarketplaceReviewVote", () => {
  const REVIEW = {
    data: { id: "rev-1", listing_id: "listing-1", reviewer_id: "author-1" },
    error: null,
  };

  const call = (
    self: any,
    voterId: string,
    helpful: boolean,
    listingId = "listing-1",
  ) =>
    marketplaceData.setMarketplaceReviewVote(
      self.supabase,
      listingId,
      "rev-1",
      voterId,
      helpful,
    );

  it("404s when the review does not belong to the listing", async () => {
    const self = {
      supabase: { from: queuedFrom({ marketplace_reviews: [REVIEW] }) },
    };
    await expect(call(self, "voter-1", true, "other-listing")).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("400s a self-vote", async () => {
    const self = {
      supabase: { from: queuedFrom({ marketplace_reviews: [REVIEW] }) },
    };
    await expect(call(self, "author-1", true)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("503s while the votes table has not been migrated", async () => {
    const self = {
      supabase: {
        from: queuedFrom({
          marketplace_reviews: [REVIEW],
          marketplace_review_votes: [
            { data: null, error: { code: "42P01", message: "missing table" } },
          ],
        }),
      },
    };
    await expect(call(self, "voter-1", true)).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it("records a vote and returns the fresh count", async () => {
    const self = {
      supabase: {
        from: queuedFrom({
          marketplace_reviews: [REVIEW],
          marketplace_review_votes: [
            { data: null, error: null }, // upsert
            { data: null, error: null, count: 3 }, // recount
          ],
        }),
      },
    };
    await expect(call(self, "voter-1", true)).resolves.toEqual({
      helpfulCount: 3,
      viewerMarkedHelpful: true,
    });
  });

  it("removes a vote and returns the fresh count", async () => {
    const self = {
      supabase: {
        from: queuedFrom({
          marketplace_reviews: [REVIEW],
          marketplace_review_votes: [
            { data: null, error: null }, // delete
            { data: null, error: null, count: 0 }, // recount
          ],
        }),
      },
    };
    await expect(call(self, "voter-1", false)).resolves.toEqual({
      helpfulCount: 0,
      viewerMarkedHelpful: false,
    });
  });
});

describe("getMarketplaceListings rating sort fallback", () => {
  const LISTING_ROW = {
    id: "listing-1",
    user_id: "seller-1",
    title: "Calc textbook",
    price: 100,
    status: "active",
    seller: { id: "seller-1", name: "Seller" },
  };

  /**
   * MOVED ONTO THE LAYER (monolith lane M3). The breaker is no longer a field
   * on `SupabaseService`, so the harness that used to be a bare `self` driven
   * through `SupabaseService.prototype.getMarketplaceListings.call(self, …)`
   * is now a real `createDataLayer(...)` over the same fake client, and the
   * assertion reads `layer.marketplace.ratingColumnsAvailable()` instead of
   * `self.ratingColumnsAvailable()`. The two stubs the old harness installed
   * as `self` members are installed as namespace members instead: the deps
   * arrows read them through the layer at CALL time, exactly as the facade's
   * `this.` arrows did.
   */
  function fakeBrowseLayer(queues: ChainResult[]) {
    const rpc = jest.fn();
    const layer = createDataLayer({
      client: { rpc, from: queuedFrom({ marketplace_listings: queues }) } as never,
      supabaseUrl: "https://example.supabase.co",
      host: new Proxy({}, { get: () => () => undefined }) as never,
    });
    layer.marketplace.normalizeListingRecordAsync = async (row: any) => row;
    layer.marketplace.attachSellerTrust = async (rows: any[]) => rows;
    return { layer, rpc };
  }

  it("routes rating sort to the fallback query, never the search RPC", async () => {
    const { layer, rpc } = fakeBrowseLayer([
      { data: [LISTING_ROW], error: null, count: 1 },
    ]);
    const result = await layer.marketplace.getMarketplaceListings({
      search: "calc",
      sortBy: "rating",
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
  });

  it("retries without rating columns when they do not exist yet", async () => {
    const missing = {
      code: "42703",
      message: 'column marketplace_listings.rating_avg does not exist',
    };
    const { layer, rpc } = fakeBrowseLayer([
      { data: null, error: missing, count: null },
      { data: [LISTING_ROW], error: null, count: 1 },
    ]);
    const result = await layer.marketplace.getMarketplaceListings({
      sortBy: "rating",
      minRating: 4,
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(result.total).toBe(1);
    // The guard remembers the failure so later queries skip the doomed
    // attempt, and it is PER LAYER: a second layer still asks.
    expect(layer.marketplace.ratingColumnsAvailable()).toBe(false);
    const { layer: other } = fakeBrowseLayer([
      { data: [LISTING_ROW], error: null, count: 1 },
    ]);
    expect(other.marketplace.ratingColumnsAvailable()).toBe(true);
  });
});
