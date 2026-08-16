/**
 * Verified-purchase review gate. addMarketplaceReview used to upsert whatever
 * arrived: any authed user could review any listing — their own included —
 * with any rating. These tests drive the prototype methods against a stubbed
 * `this`, so the 9k-line service never has to be constructed.
 */
import { SupabaseService } from "./supabase";

type ChainResult = { data: unknown; error?: unknown };

/** Minimal PostgREST chain: every builder returns itself; awaiting resolves. */
function chain(result: ChainResult) {
  const api: any = {};
  const self = () => api;
  api.select = self;
  api.eq = self;
  api.in = self;
  api.limit = self;
  api.order = self;
  api.upsert = self;
  api.single = async () => result;
  api.maybeSingle = async () => result;
  api.then = (resolve: (value: ChainResult) => unknown) =>
    Promise.resolve(result).then(resolve);
  return api;
}

describe("canUserReviewListing", () => {
  const LISTING = { id: "listing-1", user_id: "seller-1", seller_id: "seller-1" };

  function fakeService(tables: Record<string, ChainResult>) {
    return {
      getMarketplaceListingById: jest.fn(async () => LISTING),
      supabase: {
        from: (table: string) => chain(tables[table] ?? { data: [], error: null }),
      },
    };
  }

  const call = (self: unknown, listingId: string, userId: string) =>
    SupabaseService.prototype.canUserReviewListing.call(self as any, listingId, userId);

  it("blocks the seller from reviewing their own listing", async () => {
    const self = fakeService({});
    await expect(call(self, "listing-1", "seller-1")).resolves.toMatchObject({
      eligible: false,
      reason: expect.stringContaining("own listing"),
    });
  });

  it("allows a buyer with a delivered order", async () => {
    const self = fakeService({
      marketplace_orders: { data: [{ id: "order-1" }], error: null },
    });
    await expect(call(self, "listing-1", "buyer-1")).resolves.toEqual({
      eligible: true,
    });
  });

  it("allows a buyer whose inquiry the seller marked purchased", async () => {
    const self = fakeService({
      marketplace_orders: { data: [], error: null },
      marketplace_inquiries: { data: [{ id: "inq-1" }], error: null },
    });
    await expect(call(self, "listing-1", "buyer-1")).resolves.toEqual({
      eligible: true,
    });
  });

  it("rejects a user with no completed purchase", async () => {
    const self = fakeService({});
    await expect(call(self, "listing-1", "stranger-1")).resolves.toMatchObject({
      eligible: false,
      reason: expect.stringContaining("completed a purchase"),
    });
  });
});

describe("addMarketplaceReview validation", () => {
  const REVIEW_ROW = { data: { id: "rev-1", rating: 5 }, error: null };

  function fakeSelf(eligible: boolean) {
    return {
      canUserReviewListing: jest.fn(async () => ({
        eligible,
        reason: eligible ? undefined : "Reviews are limited to buyers who completed a purchase",
      })),
      supabase: { from: () => chain(REVIEW_ROW) },
    };
  }

  const call = (self: unknown, review: { rating: number; comment?: string }) =>
    SupabaseService.prototype.addMarketplaceReview.call(
      self as any,
      "listing-1",
      "buyer-1",
      review,
    );

  it.each([[0], [6], [3.5], [Number.NaN]])("rejects rating %p", async (rating) => {
    await expect(call(fakeSelf(true), { rating: rating as number })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("rejects an oversized comment", async () => {
    await expect(
      call(fakeSelf(true), { rating: 5, comment: "x".repeat(2001) }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects an ineligible reviewer with 403", async () => {
    await expect(call(fakeSelf(false), { rating: 5 })).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("stores a valid review from an eligible buyer", async () => {
    await expect(call(fakeSelf(true), { rating: 5, comment: "great" })).resolves.toBeTruthy();
  });
});
