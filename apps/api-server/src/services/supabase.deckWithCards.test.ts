/**
 * The invariant: an error from createDeckWithCards means NO deck survives.
 *
 * Two-step creation (insert deck, then insert cards) is what stranded empty
 * "0 cards" decks on the server when a client died in between — the client
 * rollback could only remove its local copy. With the RPC present the write is
 * one transaction; without it (migrations here are hand-applied) the deck row
 * is deleted again on any card failure.
 */
import * as offlineBundlesData from './data/offlineBundles';
/**
 * HARNESS (monolith lane M3, Phase B): this suite used to drive
 * `SupabaseService.prototype.<m>.call(self, …)`. It now calls the data module
 * that owns the body. Nothing else moved: the same stand-in is built the same
 * way, and it is passed as the `deps` literal, which is what the facade's
 * inline `deps` arrows read off `this` anyway. Every `it` title, every
 * `expect` and every fixture is byte-identical.
 */
import * as decksData from './data/decks';
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

import { DeckWithCardsError, validateDeckCards } from "./deckWithCards";

type Call = { table: string; ops: Array<{ fn: string; args: any[] }> };

type Outcomes = {
  rpc?: { data?: unknown; error?: unknown };
  cardsInsert?: { data?: unknown; error?: unknown };
  deckDelete?: { error?: unknown };
  /** What a plain `decks` read answers; defaults to the row the `eq("id")` asked for. */
  deckSelect?: { data?: unknown; error?: unknown };
};

function fakeSelf(outcomes: Outcomes) {
  const calls: Call[] = [];
  const rpcArgs: any[] = [];

  const client: any = {
    rpc(name: string, args: unknown) {
      rpcArgs.push({ name, args });
      return Promise.resolve(outcomes.rpc ?? { data: null, error: { code: "PGRST202" } });
    },
    from(table: string) {
      const ops: Call["ops"] = [];
      const chain: any = {};
      for (const fn of ["select", "eq", "insert", "update", "delete", "in", "limit", "order", "range", "is", "not"]) {
        chain[fn] = (...args: any[]) => {
          ops.push({ fn, args });
          return chain;
        };
      }
      const settle = () => {
        calls.push({ table, ops });
        const isInsert = ops.some((op) => op.fn === "insert");
        const isDelete = ops.some((op) => op.fn === "delete");
        if (table === "decks" && isDelete) {
          return Promise.resolve({ data: null, error: outcomes.deckDelete?.error ?? null });
        }
        if (table === "decks" && isInsert) {
          return Promise.resolve({ data: { id: "deck-1", name: "SDOH" }, error: null });
        }
        if (table === "decks") {
          if (outcomes.deckSelect) return Promise.resolve(outcomes.deckSelect);
          const askedFor = ops.find((op) => op.fn === "eq" && op.args[0] === "id")?.args[1];
          return Promise.resolve({
            data: { id: askedFor ?? "deck-1", name: "SDOH", topic_id: "topic-3" },
            error: null,
          });
        }
        if (table === "flashcards" && isInsert) {
          return Promise.resolve(
            outcomes.cardsInsert ?? { data: [{ id: "c1" }, { id: "c2" }], error: null }
          );
        }
        return Promise.resolve({ data: [{ id: "c1" }, { id: "c2" }], error: null });
      };
      chain.single = settle;
      chain.maybeSingle = settle;
      chain.then = (onOk: any, onErr: any) => settle().then(onOk, onErr);
      return chain;
    },
  };

  // Was `Object.create(SupabaseService.prototype)`, which silently inherited
  // every facade method. The two the code under test actually reads are named
  // here instead: `getResponseProfile` is the three-line coercion the facade
  // held privately (`data/index.ts` inlines the same one), and
  // `resolveArtefactTopic` short-circuits because no deck here names a topic.
  const self: any = {
    supabase: client,
    getResponseProfile: (profile?: string) =>
      profile === "compact" ? "compact" : "full",
  };
  self.resolveArtefactTopic = jest.fn(async () => undefined);
  return { self, calls, rpcArgs };
}

const twoCards = () => {
  const result = validateDeckCards([
    { front: "q1", back: "a1" },
    { front: "q2", back: "a2" },
  ]);
  if (!result.ok) throw new Error("fixture invalid");
  return result.cards;
};

const create = (self: any) =>
  decksData.createDeckWithCards((self as any).supabase, self as any, { name: "SDOH", description: "" }, twoCards(), "user-1");

beforeEach(() => jest.clearAllMocks());

describe("createDeckWithCards", () => {
  it("uses the atomic RPC when the migration is applied", async () => {
    const { self, calls, rpcArgs } = fakeSelf({
      rpc: { data: { deckId: "deck-1", cardIds: ["c1", "c2"], cardCount: 2 }, error: null },
    });

    const result = await create(self);

    expect(rpcArgs[0].name).toBe("create_deck_with_cards");
    expect(rpcArgs[0].args.p_owner).toBe("user-1");
    expect(rpcArgs[0].args.p_cards).toHaveLength(2);
    expect(result.atomic).toBe(true);
    // Nothing was inserted by hand — the function owns the whole write.
    expect(calls.some((c) => c.ops.some((op) => op.fn === "insert"))).toBe(false);
  });

  it("falls back to insert-then-insert while the RPC is missing", async () => {
    const { self, calls } = fakeSelf({ rpc: { data: null, error: { code: "PGRST202" } } });

    const result = await create(self);

    expect(result.atomic).toBe(false);
    expect(result.flashcards).toHaveLength(2);
    expect(calls.filter((c) => c.table === "decks" && c.ops.some((o) => o.fn === "insert"))).toHaveLength(1);
    expect(calls.some((c) => c.table === "decks" && c.ops.some((o) => o.fn === "delete"))).toBe(false);
  });

  it("deletes the deck again when the cards fail — no empty deck survives", async () => {
    const { self, calls } = fakeSelf({
      rpc: { data: null, error: { code: "PGRST202" } },
      cardsInsert: { data: null, error: { code: "23514", message: "check constraint" } },
    });

    await expect(create(self)).rejects.toMatchObject({
      name: "DeckWithCardsError",
      code: "CARD_WRITE_FAILED",
      rolledBack: true,
    });

    const deletes = calls.filter(
      (c) => c.table === "decks" && c.ops.some((o) => o.fn === "delete")
    );
    expect(deletes).toHaveLength(1);
    expect(deletes[0].ops.find((o) => o.fn === "eq")?.args).toEqual(["id", "deck-1"]);
  });

  it("reports rolledBack: false when even the cleanup delete fails", async () => {
    const { self } = fakeSelf({
      rpc: { data: null, error: { code: "PGRST202" } },
      cardsInsert: { data: null, error: { message: "boom" } },
      deckDelete: { error: { message: "delete failed" } },
    });

    await expect(create(self)).rejects.toMatchObject({ rolledBack: false });
  });

  it("treats a short insert as a failure — a partial deck is still empty enough to be wrong", async () => {
    const { self, calls } = fakeSelf({
      rpc: { data: null, error: { code: "PGRST202" } },
      cardsInsert: { data: [{ id: "c1" }], error: null },
    });

    await expect(create(self)).rejects.toBeInstanceOf(DeckWithCardsError);
    expect(calls.some((c) => c.table === "decks" && c.ops.some((o) => o.fn === "delete"))).toBe(true);
  });

  it("does not fall back when the RPC itself rejects the write", async () => {
    const { self, calls } = fakeSelf({
      rpc: { data: null, error: { code: "22023", message: "EMPTY_CARDS" } },
    });

    await expect(create(self)).rejects.toBeInstanceOf(DeckWithCardsError);
    // A transactional failure wrote nothing; retrying by hand could create the
    // very deck the RPC refused.
    expect(calls.some((c) => c.ops.some((op) => op.fn === "insert"))).toBe(false);
  });
});

/**
 * Saving into a deck the student already has. No deck row is written, so the
 * one card insert is the whole transaction: there is nothing to compensate,
 * and there must never be a second deck.
 */
describe("addCardsToExistingDeck", () => {
  const addTo = (self: any) =>
    decksData.addCardsToExistingDeck((self as any).supabase, self as any, "deck-9", twoCards(), "user-1");

  it("inserts the cards into the named deck and returns that deck", async () => {
    const { self, calls } = fakeSelf({});
    self.verifyDeckAccess = jest.fn(async () => true);

    const result = await addTo(self);

    expect(result?.deck.id).toBe("deck-9");
    // The whole row: the client merges it over its local deck, and a
    // projection without topic_id would un-file the deck from its topic.
    expect(result?.deck.topic_id).toBe("topic-3");
    expect(result?.flashcards).toHaveLength(2);
    expect(result?.atomic).toBe(true);
    // The duplicate-deck bug: no deck row may be written on this path.
    expect(calls.some((c) => c.table === "decks" && c.ops.some((o) => o.fn === "insert"))).toBe(
      false
    );
    const insert = calls.find((c) => c.table === "flashcards" && c.ops.some((o) => o.fn === "insert"));
    expect(insert?.ops.find((o) => o.fn === "insert")?.args[0]).toEqual([
      expect.objectContaining({ deck_id: "deck-9" }),
      expect.objectContaining({ deck_id: "deck-9" }),
    ]);
    expect(self.verifyDeckAccess).toHaveBeenCalledWith("user-1", "deck-9", "edit");
  });

  it("returns null when the caller may not edit the deck — nothing is written", async () => {
    const { self, calls } = fakeSelf({});
    self.verifyDeckAccess = jest.fn(async () => false);

    expect(await addTo(self)).toBeNull();
    expect(calls.some((c) => c.ops.some((o) => o.fn === "insert"))).toBe(false);
  });

  it("returns null when the deck is gone", async () => {
    const { self, calls } = fakeSelf({ deckSelect: { data: null, error: null } });
    self.verifyDeckAccess = jest.fn(async () => true);

    expect(await addTo(self)).toBeNull();
    expect(calls.some((c) => c.ops.some((o) => o.fn === "insert"))).toBe(false);
  });

  it("reports a card failure as nothing-saved, with the deck left alone", async () => {
    const { self, calls } = fakeSelf({
      cardsInsert: { data: null, error: { code: "23514", message: "check constraint" } },
    });
    self.verifyDeckAccess = jest.fn(async () => true);

    await expect(addTo(self)).rejects.toMatchObject({
      name: "DeckWithCardsError",
      code: "CARD_WRITE_FAILED",
      rolledBack: true,
    });
    // The student's own deck must survive the failure.
    expect(calls.some((c) => c.table === "decks" && c.ops.some((o) => o.fn === "delete"))).toBe(
      false
    );
  });

  it("treats a short insert as a failure", async () => {
    const { self } = fakeSelf({ cardsInsert: { data: [{ id: "c1" }], error: null } });
    self.verifyDeckAccess = jest.fn(async () => true);

    await expect(addTo(self)).rejects.toBeInstanceOf(DeckWithCardsError);
  });
});

/**
 * Where a deck is filed has to come back out of the projection.
 *
 * The mappers have always read `study_set_id`, but no deck SELECT projected it,
 * so every deck the API answered with carried `studySetId: null`. A study set's
 * Cards grid therefore showed 0 decks however correctly they were filed, and
 * `GET /decks/<id>` reported an unfiled deck. A column the mapper reads and the
 * query never asks for is a silent data loss, so the projections are asserted.
 */
describe("deck projections carry where the deck is filed", () => {
  const selectsFor = (calls: Call[]): string[] =>
    calls
      .filter((c) => c.table === "decks")
      .flatMap((c) => c.ops.filter((op) => op.fn === "select").map((op) => String(op.args[0])));

  it("getDeck asks for course_id and study_set_id", async () => {
    const { self, calls } = fakeSelf({});

    await decksData.getDeck((self as any).supabase, "deck-1");

    const select = selectsFor(calls)[0];
    expect(select).toContain("study_set_id");
    expect(select).toContain("course_id");
  });

  it("fetchDeckRecord asks for study_set_id", async () => {
    const { self, calls } = fakeSelf({});

    await offlineBundlesData.fetchDeckRecord(self.supabase, "deck-1");

    expect(selectsFor(calls)[0]).toContain("study_set_id");
  });

  it("getDecks asks for study_set_id on both response profiles", async () => {
    for (const responseProfile of ["compact", "full"] as const) {
      const { self, calls } = fakeSelf({ deckSelect: { data: [], error: null } });
      self.getAccessibleDeckIds = jest.fn(async () => ["deck-1"]);

      await decksData.getDecks((self as any).supabase, self as any, "user-1", false, { responseProfile });

      const selects = selectsFor(calls);
      expect(selects.length).toBeGreaterThan(0);
      expect(selects.some((s) => s.includes("study_set_id"))).toBe(true);
    }
  });
});
