/**
 * Provenance and the group-read rule.
 *
 * A retake needs two things off a finished session: the questions, and what
 * the test WAS. The second used to mean digging four different keys out of
 * `config` — which every client did differently, and mobile did not do at all.
 * `buildTestProvenance` is the single answer, and these pin its precedence.
 */
import { buildAttemptTally, buildTestProvenance, mapTestListRow } from "./supabase";
import * as testsData from "./data/tests";

describe("buildTestProvenance", () => {
  it("names the note a quiz was generated from", () => {
    expect(
      buildTestProvenance({
        config: { sourceNoteId: "note-1", sourceNoteTitle: "Cardiology" },
      }),
    ).toEqual({ noteId: "note-1", deckId: null, groupId: null, title: "Cardiology" });
  });

  it("names the deck a test was drawn from", () => {
    expect(
      buildTestProvenance({ config: { sourceDeckId: "deck-1", sourceDeckTitle: "Pharm cards" } }),
    ).toEqual({ noteId: null, deckId: "deck-1", groupId: null, title: "Pharm cards" });
  });

  it("names the group whose bank built the test", () => {
    expect(buildTestProvenance({ config: { groupId: "group-1", groupName: "Physio II" } })).toEqual({
      noteId: null,
      deckId: null,
      groupId: "group-1",
      title: "Physio II",
    });
  });

  it("prefers the note when a note quiz also carries a group id — that is the source a student recognises", () => {
    const provenance = buildTestProvenance({
      config: {
        sourceNoteId: "note-1",
        sourceNoteTitle: "Cardiology",
        groupId: "group-1",
        groupName: "Physio II",
      },
    });
    expect(provenance.title).toBe("Cardiology");
    // The group id is still reported — only the title has a winner.
    expect(provenance.groupId).toBe("group-1");
  });

  it("is all nulls for a session with no source, never undefined", () => {
    expect(buildTestProvenance({ config: {} })).toEqual({
      noteId: null,
      deckId: null,
      groupId: null,
      title: null,
    });
    expect(buildTestProvenance({})).toEqual({
      noteId: null,
      deckId: null,
      groupId: null,
      title: null,
    });
  });

  it("rides along on every list row, so the list and the detail agree", () => {
    const row = mapTestListRow(
      {
        id: "test-1",
        status: "completed",
        end_time: "2026-09-04T09:20:00.000Z",
        config: { sourceDeckId: "deck-1", sourceDeckTitle: "Pharm cards" },
        questions: [],
        user_answers: {},
      },
      false,
    );
    expect(row.provenance).toEqual({
      noteId: null,
      deckId: "deck-1",
      groupId: null,
      title: "Pharm cards",
    });
  });
});

describe("buildAttemptTally", () => {
  const session = {
    questions: [
      { id: "q1", question: "Q1", type: "multiple_choice_single", options: ["yes", "no"], correctAnswer: "yes" },
      { id: "q2", question: "Q2", type: "multiple_choice_single", options: ["yes", "no"], correctAnswer: "yes" },
    ],
    user_answers: { q1: { questionId: "q1", selectedOptionIds: ["1"] } },
  };

  it("counts the untouched question as unanswered, not wrong", () => {
    expect(buildAttemptTally(session)).toMatchObject({
      total: 2,
      answered: 1,
      correct: 1,
      incorrect: 0,
      unanswered: 1,
    });
  });

  it("returns zeroes for a session with no questions rather than throwing", () => {
    expect(buildAttemptTally({}).total).toBe(0);
  });
});

/**
 * `resolveTestSessionForCaller` is where the 404 that broke every retake lived.
 * Driven against the prototype with a stubbed client so no network is needed.
 */
describe("resolveTestSessionForCaller", () => {
  const row = { id: "test-1", user_id: "owner", config: { groupId: "group-7" } };

  const service = (opts: {
    owned?: unknown;
    fetched?: unknown;
    isMember?: boolean;
  }) =>
    ({
      getTestById: jest.fn().mockResolvedValue(opts.owned ?? null),
      isGroupMember: jest.fn().mockResolvedValue(opts.isMember ?? false),
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: opts.fetched ?? null, error: null }),
            }),
          }),
        }),
      },
      // The body lives in `data/tests.ts`; the facade only forwarded
      // `(this.supabase, {deps…}, …)`, and this stand-in carries those deps —
      // so the method keeps its name and the assertions below are untouched.
      resolveTestSessionForCaller: function (this: any, testId: string, userId: string) {
        return testsData.resolveTestSessionForCaller(this.supabase, this, testId, userId);
      },
    }) as any;

  it("answers for the owner", async () => {
    const svc = service({ owned: row });
    await expect(svc.resolveTestSessionForCaller("test-1", "owner")).resolves.toEqual({
      session: row,
      access: "owner",
    });
  });

  it("answers for a member of the group the session belongs to", async () => {
    const svc = service({ fetched: row, isMember: true });
    await expect(svc.resolveTestSessionForCaller("test-1", "member")).resolves.toEqual({
      session: row,
      access: "group",
    });
  });

  it("refuses a non-member of that group", async () => {
    const svc = service({ fetched: row, isMember: false });
    await expect(svc.resolveTestSessionForCaller("test-1", "stranger")).resolves.toBeNull();
  });

  it("refuses a personal session belonging to someone else — no group, no access", async () => {
    const svc = service({ fetched: { id: "test-1", user_id: "owner", config: {} }, isMember: true });
    await expect(svc.resolveTestSessionForCaller("test-1", "stranger")).resolves.toBeNull();
  });

  it("returns null for a session that does not exist", async () => {
    const svc = service({});
    await expect(svc.resolveTestSessionForCaller("missing", "anyone")).resolves.toBeNull();
  });
});
