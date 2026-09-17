/**
 * resetDeckStatistics wiped srs_data on every card in the deck but only
 * invalidated the flashcard LIST caches (`flashcards:*`) — never the per-card
 * entries the review path actually reads (`flashcard:{id}` and
 * `flashcard:{id}:user:{userId}`). A review graded right after a reset loaded
 * the stale cached card, validated against its stale version, and was silently
 * dropped. The reset must purge every card's cache entries.
 */
/**
 * HARNESS (monolith lane M3, Phase B): this suite used to drive
 * `SupabaseService.prototype.<m>.call(self, …)`. It now calls the data module
 * that owns the body. Nothing else moved: the same stand-in is built the same
 * way, and it is passed as the `deps` literal, which is what the facade's
 * inline `deps` arrows read off `this` anyway. Every `it` title, every
 * `expect` and every fixture is byte-identical.
 */
import * as offlineBundlesData from './data/offlineBundles';
jest.mock("./cache", () => ({
  cacheService: {
    get: jest.fn(async () => null),
    set: jest.fn(async () => {}),
    delete: jest.fn(async () => {}),
    deletePattern: jest.fn(async () => {}),
    cached: async (_key: string, fn: () => Promise<unknown>) => fn(),
    invalidateUserCache: jest.fn(async () => {}),
  },
}));

jest.mock("../utils/logger", () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { cacheService } from "./cache";

type Op = { fn: string; args: any[] };

function fakeSelf(cardIds: string[]) {
  const flashcardCalls: Op[][] = [];
  const client = {
    from(table: string) {
      const ops: Op[] = [];
      const chain: any = {};
      for (const fn of ["select", "eq", "update", "in", "order", "limit"]) {
        chain[fn] = (...args: any[]) => {
          ops.push({ fn, args });
          return chain;
        };
      }
      chain.then = (onOk: any, onErr: any) => {
        if (table === "flashcards") flashcardCalls.push(ops);
        const isSelect = ops.some((op) => op.fn === "select");
        const result = isSelect
          ? { data: cardIds.map((id) => ({ id })), error: null }
          : { data: null, error: null };
        return Promise.resolve(result).then(onOk, onErr);
      };
      return chain;
    },
  };
  return {
    flashcardCalls,
    self: {
      verifyDeckAccess: jest.fn(async () => true),
      supabase: client,
    },
  };
}

const reset = (self: unknown) =>
  offlineBundlesData.resetDeckStatistics((self as any).supabase, self as any, "deck-1", "u1");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("resetDeckStatistics cache invalidation", () => {
  it("purges every per-card cache entry after the bulk reset", async () => {
    const { self } = fakeSelf(["c1", "c2"]);

    await expect(reset(self)).resolves.toEqual({ success: true });

    // Per-card entries the review path reads (getFlashcard / getFlashcardForUser).
    expect(cacheService.delete).toHaveBeenCalledWith("flashcard:c1");
    expect(cacheService.delete).toHaveBeenCalledWith("flashcard:c2");
    expect(cacheService.deletePattern).toHaveBeenCalledWith("flashcard:c1:user:*");
    expect(cacheService.deletePattern).toHaveBeenCalledWith("flashcard:c2:user:*");
    // Pre-existing list + deck invalidation stays.
    expect(cacheService.deletePattern).toHaveBeenCalledWith("flashcards:*");
    expect(cacheService.delete).toHaveBeenCalledWith("deck:deck-1");
  });

  it("selects card ids scoped to the deck being reset", async () => {
    const { self, flashcardCalls } = fakeSelf(["c1"]);

    await reset(self);

    const selectCall = flashcardCalls.find((ops) => ops.some((op) => op.fn === "select"));
    expect(selectCall).toBeDefined();
    expect(selectCall).toContainEqual({ fn: "select", args: ["id"] });
    expect(selectCall).toContainEqual({ fn: "eq", args: ["deck_id", "deck-1"] });
  });

  it("still clears list and deck caches for an empty deck", async () => {
    const { self } = fakeSelf([]);

    await expect(reset(self)).resolves.toEqual({ success: true });

    expect(cacheService.deletePattern).toHaveBeenCalledWith("flashcards:*");
    expect(cacheService.delete).toHaveBeenCalledWith("deck:deck-1");
    expect(cacheService.delete).not.toHaveBeenCalledWith(expect.stringMatching(/^flashcard:c/));
  });

  it("touches nothing when deck access is denied", async () => {
    const { self } = fakeSelf(["c1"]);
    (self.verifyDeckAccess as jest.Mock).mockResolvedValueOnce(false);

    await expect(reset(self)).rejects.toThrow("Deck not found or access denied");
    expect(cacheService.delete).not.toHaveBeenCalled();
    expect(cacheService.deletePattern).not.toHaveBeenCalled();
  });
});
