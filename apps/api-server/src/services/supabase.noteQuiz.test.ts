/**
 * upsertNoteQuiz regenerate guard.
 *
 * The regenerate UPDATE used to carry `.eq("answers", {})` as a race guard —
 * but postgrest-js serializes that as `answers=eq.[object Object]`, which
 * Postgres cannot cast to jsonb, so regenerating an UNTOUCHED quiz 500'd every
 * time (after the AI had already produced the new questions). The pre-check
 * already refuses quizzes with answers or completed=true, so the update keeps
 * only `completed=false` as its race guard.
 *
 * A refused regenerate now also says so: the returned quiz carries
 * `reused: true` so clients can toast honestly (absent means fresh).
 */
/**
 * HARNESS (monolith lane M3, Phase B): this suite used to drive
 * `SupabaseService.prototype.<m>.call(self, …)`. It now calls the data module
 * that owns the body. Nothing else moved: the same stand-in is built the same
 * way, and it is passed as the `deps` literal, which is what the facade's
 * inline `deps` arrows read off `this` anyway. Every `it` title, every
 * `expect` and every fixture is byte-identical.
 */
import * as notesData from './data/notes';

type Op = { fn: string; args: any[] };
type Call = { table: string; ops: Op[]; terminal: string };
type ChainResult = { data: unknown; error?: unknown };

/** Minimal postgrest chain: records every builder call, defers the result. */
function fakeDb(resolve: (call: Call) => ChainResult) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const ops: Op[] = [];
      const chain: any = {};
      for (const fn of ["select", "eq", "update", "insert", "order", "limit"]) {
        chain[fn] = (...args: any[]) => {
          ops.push({ fn, args });
          return chain;
        };
      }
      const settle = (terminal: string) => {
        const call: Call = { table, ops, terminal };
        calls.push(call);
        return Promise.resolve(resolve(call));
      };
      chain.single = () => settle("single");
      chain.maybeSingle = () => settle("maybeSingle");
      chain.then = (onOk: any, onErr: any) => settle("then").then(onOk, onErr);
      return chain;
    },
  };
  return { client, calls };
}

const NEW_QUESTIONS = [{ id: "nq-0", text: "What is 2+2?" }];

const quizRow = (overrides: Record<string, unknown> = {}) => ({
  note_id: "note-1",
  user_id: "u1",
  questions: NEW_QUESTIONS,
  answers: {},
  completed: false,
  updated_at: "2026-08-20T10:00:00.000Z",
  ...overrides,
});

function fakeSelf(
  existingQuizzes: Array<any>,
  resolve: (call: Call) => ChainResult,
) {
  const { client, calls } = fakeDb(resolve);
  let quizReads = 0;
  const self = {
    getNote: jest.fn(async () => ({ id: "note-1" })),
    getNoteQuiz: jest.fn(async () => existingQuizzes[Math.min(quizReads++, existingQuizzes.length - 1)]),
    isNoteQuizProtected: notesData.isNoteQuizProtected,
    mapNoteQuiz: notesData.mapNoteQuiz,
    supabase: client,
  };
  return { self, calls };
}

const upsert = (self: unknown) =>
  notesData.upsertNoteQuiz((self as any).supabase, self as any, "u1", "note-1", {
    studyGoal: "retention",
    questions: NEW_QUESTIONS,
  });

describe("upsertNoteQuiz regenerate", () => {
  it("persists new questions for an untouched quiz — and no jsonb answers filter", async () => {
    const { self, calls } = fakeSelf(
      [{ noteId: "note-1", questions: [{ id: "old" }], answers: {}, completed: false }],
      () => ({ data: quizRow(), error: null }),
    );

    const result: any = await upsert(self);

    expect(result.questions).toEqual(NEW_QUESTIONS);
    expect(result.reused).toBeUndefined();

    const update = calls.find((c) => c.ops.some((op) => op.fn === "update"));
    expect(update).toBeDefined();
    const eqs = update!.ops.filter((op) => op.fn === "eq").map((op) => op.args);
    // The broken clause: `.eq("answers", {})` serialized to `[object Object]`
    // and made Postgres reject the whole update. It must never come back.
    expect(eqs.map(([col]) => col)).not.toContain("answers");
    expect(eqs).toContainEqual(["completed", false]);
    const payload = update!.ops.find((op) => op.fn === "update")!.args[0];
    expect(payload.questions).toEqual(NEW_QUESTIONS);
  });

  it("returns the existing quiz with reused:true for a completed one, without updating", async () => {
    const existing = { noteId: "note-1", questions: [{ id: "old" }], answers: {}, completed: true };
    const { self, calls } = fakeSelf([existing], () => ({ data: null, error: null }));

    const result: any = await upsert(self);

    expect(result).toEqual({ ...existing, reused: true });
    expect(calls).toHaveLength(0);
  });

  it("returns reused:true for a quiz with recorded answers", async () => {
    const existing = {
      noteId: "note-1",
      questions: [{ id: "old" }],
      answers: { "nq-0": "A" },
      completed: false,
    };
    const { self, calls } = fakeSelf([existing], () => ({ data: null, error: null }));

    const result: any = await upsert(self);

    expect(result.reused).toBe(true);
    expect(result.questions).toEqual(existing.questions);
    expect(calls).toHaveLength(0);
  });

  it("hands back the winner with reused:true when the quiz completes mid-regenerate", async () => {
    const untouched = { noteId: "note-1", questions: [{ id: "old" }], answers: {}, completed: false };
    const winner = { noteId: "note-1", questions: [{ id: "old" }], answers: { "nq-0": "A" }, completed: true };
    // Pre-check sees an untouched quiz; the guarded update then matches 0 rows.
    const { self } = fakeSelf([untouched, winner], () => ({ data: null, error: null }));

    const result: any = await upsert(self);

    expect(result).toEqual({ ...winner, reused: true });
  });

  it("surfaces a real update error instead of masking it", async () => {
    const { self } = fakeSelf(
      [{ noteId: "note-1", questions: [], answers: {}, completed: false }],
      () => ({ data: null, error: new Error("boom") }),
    );

    await expect(upsert(self)).rejects.toThrow("boom");
  });
});

describe("isNoteQuizProtected", () => {
  const protectedOf = (quiz: any) =>
    notesData.isNoteQuizProtected(quiz);

  it("protects completed quizzes and quizzes with any answers", () => {
    expect(protectedOf({ completed: true, answers: {} })).toBe(true);
    expect(protectedOf({ completed: false, answers: { a: "1" } })).toBe(true);
  });

  it("leaves untouched or missing quizzes unprotected", () => {
    expect(protectedOf({ completed: false, answers: {} })).toBe(false);
    expect(protectedOf({ completed: false, answers: null })).toBe(false);
    expect(protectedOf(null)).toBe(false);
    expect(protectedOf(undefined)).toBe(false);
  });
});
