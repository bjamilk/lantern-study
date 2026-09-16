/**
 * `mapChatMessageRow` — the one row→DTO serialiser every chat surface goes
 * through. These tests pin the two things it is easy to get wrong when a
 * loader copies it: the top-level `senderId` every client branches on (#76),
 * and the email scrub on the sender's display name.
 */
import { mapChatMessageRow, mapProfileSender, resolveNestedProfile } from "./mappers";

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "m1",
  group_id: "g1",
  sender_id: "u1",
  timestamp: "2026-09-16T00:00:00.000Z",
  profiles: { id: "u1", name: "Ada", username: "ada", avatar_url: null },
  ...overrides,
});

const text = { type: "TEXT" as const, text: "hi" };

describe("mapChatMessageRow", () => {
  it("emits the top-level senderId every client checks", () => {
    expect(mapChatMessageRow(row(), text).senderId).toBe("u1");
  });

  it("emits senderId for the question pool too", () => {
    // The question-pool loader used to pass `{ includeSenderId: false }`, so
    // the same message answered with `sender.id` but no `senderId` depending
    // on which endpoint it came from. Both the option and that call site are
    // gone; every loader goes through this one mapper and gets the field.
    expect(mapChatMessageRow(row(), text).senderId).toBe("u1");
  });

  it("keeps sender.id and senderId consistent", () => {
    const mapped = mapChatMessageRow(row(), text);
    expect(mapped.sender.id).toBe(mapped.senderId);
  });

  it("lets the normalized record win over the envelope", () => {
    const mapped = mapChatMessageRow(row({ upvotes: 3 }), {
      type: "QUESTION",
      upvotes: 9,
    } as any);
    expect(mapped.upvotes).toBe(9);
  });
});

describe("mapProfileSender", () => {
  it("never publishes an email address as a display name", () => {
    const sender = mapProfileSender({ id: "u1", name: "ada@example.com" }, "u1");
    expect(sender.name).not.toContain("@example.com");
  });

  it("falls back to the row's sender id when there is no profile", () => {
    expect(mapProfileSender(null, "u9").id).toBe("u9");
  });
});

describe("resolveNestedProfile", () => {
  it("reads PostgREST's array and object embed shapes alike", () => {
    expect(resolveNestedProfile([{ id: "u1" }])).toEqual({ id: "u1" });
    expect(resolveNestedProfile({ id: "u2" })).toEqual({ id: "u2" });
    expect(resolveNestedProfile(null)).toBeNull();
  });
});
