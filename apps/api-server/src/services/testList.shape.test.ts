/**
 * GET /api/v1/tests — the row shape "Available Tests" depends on.
 *
 * On device (build 158) a quiz generated from a note saved correctly, showed
 * under Home → Saved sessions, and the Tests list still read "No Tests
 * Available" after a refresh. The questions were there; they were just nested
 * one level down, under `session`, while the mobile list filters on the FLAT
 * `t.questions` / `t.end_time`. These pin both halves of the contract so
 * neither client can lose a test to the other's shape again.
 */
import { mapTestListRow } from "./data/testMappers";

const personalTest = {
  id: "test-1",
  user_id: "user-1",
  title: "Quiz · SDOH",
  status: "in_progress",
  session_kind: "test",
  start_time: "2026-09-05T09:00:00.000Z",
  updated_at: "2026-09-05T09:00:00.000Z",
  end_time: null,
  current_question_index: 0,
  user_answers: {},
  config: {
    name: "Quiz · SDOH",
    title: "Quiz · SDOH",
    numberOfQuestions: 5,
    sourceNoteId: "note-7",
    sourceJobId: "job-9",
    source: "note",
  },
  questions: new Array(5).fill(null).map((_, i) => ({
    id: `nq-${i}`,
    question: `Q${i}`,
    type: "multiple_choice_single",
    options: ["a", "b"],
    correctAnswer: "a",
  })),
};

const completedAttempt = {
  id: "test-2",
  status: "completed",
  session_kind: "test",
  start_time: "2026-09-01T09:00:00.000Z",
  end_time: "2026-09-01T09:30:00.000Z",
  updated_at: "2026-09-01T09:30:00.000Z",
  config: { name: "Midterm" },
  questions: [{ id: "q1", question: "Q1" }],
  user_answers: { q1: { isCorrect: true, timeSpentSeconds: 12 } },
  test_results: [{ score: 80, correct_answers_count: 4, total_questions: 5 }],
};

/** The exact predicate the mobile Tests list applies to each row. */
const mobileWouldList = (row: any) => {
  const questions = row.questions || [];
  const isCompleted = !!(row.end_time || row.endTime);
  const questionCount = questions.length || row.config?.numberOfQuestions || 0;
  return !isCompleted && questionCount > 0;
};

describe("mapTestListRow — a saved note quiz", () => {
  const row = mapTestListRow(personalTest, false);

  it("survives the mobile Available Tests filter", () => {
    expect(mobileWouldList(row)).toBe(true);
  });

  it("carries the questions a launch needs at the top level", () => {
    expect(row.questions).toHaveLength(5);
    expect(row.questions[0]).toMatchObject({ id: "nq-0" });
    expect(row.questionCount).toBe(5);
  });

  it("names itself, so the list is not a wall of Untitled Test", () => {
    expect(row.title).toBe("Quiz · SDOH");
    expect(row.config.name).toBe("Quiz · SDOH");
  });

  it("says it is a test, available, and where it came from", () => {
    expect(row.session_kind).toBe("test");
    expect(row.sessionKind).toBe("test");
    expect(row.status).toBe("in_progress");
    expect(row.availability).toBe("available");
    expect(row.sourceNoteId).toBe("note-7");
    expect(row.sourceJobId).toBe("job-9");
  });

  it("has a date, because test_sessions has no created_at column", () => {
    expect(row.created_at).toBe("2026-09-05T09:00:00.000Z");
    expect(row.end_time).toBeNull();
  });

  it("still carries the nested session web reads", () => {
    expect(row.session.questions).toHaveLength(5);
    expect(row.session.status).toBe("in_progress");
    expect(row.session.config.sourceNoteId).toBe("note-7");
  });
});

describe("mapTestListRow — a finished attempt", () => {
  const row = mapTestListRow(completedAttempt, false);

  it("is not offered as available", () => {
    expect(mobileWouldList(row)).toBe(false);
    expect(row.availability).toBe("completed");
    expect(row.end_time).toBe("2026-09-01T09:30:00.000Z");
  });

  it("does not pay for the questions twice", () => {
    // History is the long list; mirroring its questions would double every
    // page's payload for a list that never launches anything.
    expect(row.questions).toEqual([]);
    expect(row.session.questions).toHaveLength(1);
  });

  it("keeps the score and the folded timings", () => {
    expect(row.score).toBe(80);
    expect(row.correctAnswersCount).toBe(4);
    expect(row.timeSpentSeconds).toBe(12);
    expect(row.questionsWithTime).toBe(1);
  });
});

describe("mapTestListRow — lean", () => {
  it("returns the paused-session summary untouched", () => {
    const row = mapTestListRow({ ...personalTest, status: "paused" }, true);
    expect(row.session).toBeUndefined();
    expect(row).toMatchObject({
      id: "test-1",
      status: "paused",
      title: "Quiz · SDOH",
      answeredCount: 0,
      totalQuestions: 5,
    });
  });

  it("never ships questions on a lean row", () => {
    const row = mapTestListRow(completedAttempt, true);
    expect(row.questions).toEqual([]);
    expect(row.session.questions).toEqual([]);
  });
});

/**
 * D3 (build 159): the Available Tests row for a note quiz read
 * "Quiz · SDOH" / "From undefined" — the client interpolates the note title
 * into that second line and the field was simply not in the row shape.
 */
describe("mapTestListRow — the note a quiz came from", () => {
  it("names the note when the title was persisted into config", () => {
    const row = mapTestListRow(
      {
        ...personalTest,
        config: { ...personalTest.config, sourceNoteTitle: "SDOH lecture" },
      },
      false,
    );
    expect(row.sourceNoteTitle).toBe("SDOH lecture");
  });

  it("is null — never undefined — when the title is unresolved", () => {
    const row = mapTestListRow(personalTest, false);
    expect(row).toHaveProperty("sourceNoteTitle");
    expect(row.sourceNoteTitle).toBeNull();
  });

  it("is null for a test that came from no note at all", () => {
    const row = mapTestListRow(completedAttempt, false);
    expect(row.sourceNoteId).toBeNull();
    expect(row.sourceNoteTitle).toBeNull();
  });

  it("rejects a blank or non-string title rather than passing it through", () => {
    expect(
      mapTestListRow(
        { ...personalTest, config: { ...personalTest.config, sourceNoteTitle: "   " } },
        false,
      ).sourceNoteTitle,
    ).toBeNull();
    expect(
      mapTestListRow(
        { ...personalTest, config: { ...personalTest.config, sourceNoteTitle: 42 } },
        false,
      ).sourceNoteTitle,
    ).toBeNull();
  });

  it("carries the provenance on a lean paused row too", () => {
    const row = mapTestListRow(
      {
        ...personalTest,
        status: "paused",
        config: { ...personalTest.config, sourceNoteTitle: "SDOH lecture" },
      },
      true,
    );
    expect(row.sourceNoteId).toBe("note-7");
    expect(row.sourceNoteTitle).toBe("SDOH lecture");
  });
});

describe("mapTestListRow — no field is undefined", () => {
  // A missing field is invisible over JSON; an undefined one that a client
  // interpolates prints the literal "undefined" on screen. Every top-level
  // field is a real value or null.
  const undefinedKeys = (row: any) =>
    Object.entries(row)
      .filter(([, value]) => value === undefined)
      .map(([key]) => key);

  it("on a launchable note quiz", () => {
    expect(undefinedKeys(mapTestListRow(personalTest, false))).toEqual([]);
  });

  it("on a finished attempt", () => {
    expect(undefinedKeys(mapTestListRow(completedAttempt, false))).toEqual([]);
  });

  it("on a lean paused row", () => {
    expect(
      undefinedKeys(mapTestListRow({ ...personalTest, status: "paused" }, true)),
    ).toEqual([]);
  });
});
