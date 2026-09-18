/**
 * data/testMappers.ts — the pure row→DTO shapes a test session is read as.
 *
 * ## Purpose
 *
 * Moved verbatim from `services/supabase.ts` module scope (monolith lane M1c,
 * step 11), because the TESTS AND TEST SESSIONS section that uses them now
 * lives in `data/tests.ts` and a data module must not import the facade back.
 * `services/supabase.ts` re-exports all four public names from this path, so
 * every importer — and the public-surface freeze — sees no change.
 *
 * ## What it touches
 *
 * Nothing. No client, no table, no cache: five pure functions over a row.
 *
 * ## The gotcha
 *
 * `mapTestListRow` and `mapTestSessionRowToClient` (in `data/tests.ts`) are a
 * CONTRACT, not an implementation detail. Mobile's "Available Tests" list
 * reads the FLAT fields and web reads the nested `session`, so a row that
 * satisfies only one of them is invisible on the other side. Every field is a
 * string or null and never absent, so "From <title>" renders or does not, and
 * never prints "From undefined" — `normalizeSourceNoteTitle` is what enforces
 * that, and it is why a bad value written into `config` degrades one line
 * instead of reaching a client.
 *
 * `topicIdOf` distinguishes ABSENT ("topics are not available yet — the
 * 20260826120000 migration is unapplied") from null ("no topic"). Dropping
 * that distinction would report every artefact as unfiled the day before the
 * migration lands.
 */
import {
  coerceRawUserAnswers,
  tallyTestAttempt,
} from "@lantern/shared/utils/testHelpers";


/**
 * `topicId` rides on an artefact only once the column exists: absent means
 * "topics are not available yet", null means "no topic". Same rule as
 * LibrarySearchResult.topicId, so a client has one thing to branch on.
 */
export function topicIdOf(row: any): { topicId?: string | null } {
  return row && typeof row === "object" && "topic_id" in row
    ? { topicId: row.topic_id ?? null }
    : {};
}

/**
 * Same rule, one migration later: `practiceFolderId` rides on a list row only
 * once `test_sessions.practice_folder_id` exists (20260918120000, applied by
 * hand). ABSENT means "this database cannot file practice yet"; null means
 * "not in a folder". The Practice hub branches on exactly that difference —
 * absent draws the hub as it drew before folders existed, null draws the item
 * at the top level beside the folder cards. Collapsing the two would empty
 * every folder card the day before the migration lands.
 */
export function practiceFolderIdOf(row: any): { practiceFolderId?: string | null } {
  return row && typeof row === "object" && "practice_folder_id" in row
    ? { practiceFolderId: row.practice_folder_id ?? null }
    : {};
}

/**
 * A source-note title as clients may print it: a non-empty trimmed string, or
 * null. Anything else (undefined, "", a number a bad write left in config)
 * becomes null so no client ever interpolates it into "From undefined".
 */
export function normalizeSourceNoteTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 200) : null;
}

/**
 * Where a session came from, resolved once here so no client has to know the
 * config key names. Every field is a string or null — never absent — so
 * "From <title>" renders or does not, and never prints "From undefined".
 *
 * Precedence is note → deck → group: a quiz generated from a note that also
 * carries a groupId is a note quiz, because that is the source a student
 * recognises.
 */
export function buildTestProvenance(session: any): {
  noteId: string | null;
  deckId: string | null;
  groupId: string | null;
  title: string | null;
} {
  const config = (session?.config && typeof session.config === "object" ? session.config : {}) as any;
  const noteId = typeof config.sourceNoteId === "string" && config.sourceNoteId ? config.sourceNoteId : null;
  const deckId = typeof config.sourceDeckId === "string" && config.sourceDeckId ? config.sourceDeckId : null;
  const groupId = typeof config.groupId === "string" && config.groupId ? config.groupId : null;
  const title = noteId
    ? normalizeSourceNoteTitle(config.sourceNoteTitle)
    : deckId
      ? normalizeSourceNoteTitle(config.sourceDeckTitle)
      : groupId
        ? normalizeSourceNoteTitle(config.groupName)
        : null;
  return { noteId, deckId, groupId, title };
}

/**
 * Correct / incorrect / unanswered for one stored session row, plus the same
 * split by reported confidence. Never throws and never returns undefined: a
 * session with no questions tallies to all zeroes, which a client can render.
 *
 * Unanswered is its own number on purpose — see `tallyTestAttempt`.
 */
export function buildAttemptTally(session: any) {
  const questions = Array.isArray(session?.questions) ? session.questions : [];
  return tallyTestAttempt(
    questions,
    coerceRawUserAnswers(session?.user_answers ?? session?.userAnswers, questions) as Record<
      string,
      unknown
    >,
  );
}

/**
 * One row of GET /api/v1/tests, as every client reads it.
 *
 * Pure and exported because this shape is a contract, not an implementation
 * detail: mobile's "Available Tests" list reads the FLAT fields and web reads
 * the nested `session`, and a personal test that satisfies only one of them
 * is invisible on the other side.
 */
export function mapTestListRow(session: any, lean: boolean): any {
  const result = Array.isArray(session.test_results)
    ? session.test_results[0]
    : session.test_results;
  const questions = Array.isArray(session.questions)
    ? session.questions
    : [];
  const answers = coerceRawUserAnswers(session.user_answers, questions);
  const answeredCount = Object.keys(answers).length;
  const sessionStatus = session.status ||
    (session.end_time ? "completed" : "in_progress");

  // Fold per-answer timings into a sum and a count. Lean responses drop
  // user_answers, so without these the dashboards cannot compute
  // "Avg / question" or total study time and render a dash. Answers with
  // no recorded time are excluded from both, so the client can divide
  // them directly. Kept as sum+count rather than a pre-divided average so
  // the client can weight correctly when it aggregates across tests.
  let timeSpentSeconds = 0;
  let questionsWithTime = 0;
  for (const answer of Object.values(answers) as any[]) {
    const spent = answer?.timeSpentSeconds ?? answer?.time_spent_seconds;
    if (typeof spent === "number" && Number.isFinite(spent)) {
      timeSpentSeconds += spent;
      questionsWithTime++;
    }
  }

  if (
    lean &&
    (sessionStatus === "paused" || sessionStatus === "in_progress")
  ) {
    return {
      id: session.id,
      sessionKind: session.session_kind || "test",
      status: sessionStatus,
      title:
        session.title ||
        session.config?.groupName ||
        (session.session_kind === "study" ? "Study session" : "Test"),
      answeredCount,
      totalQuestions: questions.length,
      currentQuestionIndex: session.current_question_index || 0,
      remainingTimeSeconds: session.remaining_time_seconds ?? null,
      startTime: session.start_time || new Date().toISOString(),
      updatedAt: session.updated_at || session.start_time || new Date().toISOString(),
      pausedAt: session.paused_at ?? null,
      groupId: session.config?.groupId ?? null,
      ...practiceFolderIdOf(session),
      sourceNoteId: session.config?.sourceNoteId ?? null,
      sourceNoteTitle: normalizeSourceNoteTitle(session.config?.sourceNoteTitle),
      provenance: buildTestProvenance(session),
    };
  }

  // A launchable test: unfinished and carrying questions — exactly what the
  // mobile "Available Tests" tab lists.
  const launchable = !session.end_time && questions.length > 0;

  return {
    id: session.id,
    ...practiceFolderIdOf(session),
    // --- Flat mirror: the "Available Tests" contract ---------------------
    //
    // The nested `session` below is what web reads. Mobile reads the FLAT row
    // — `t.questions`, `t.config`, `t.end_time` — so every personal test was
    // filtered out before it was ever drawn: its questions sat one level in,
    // `questions.length` was 0, and a quiz saved from a note appeared nowhere
    // while "No Tests Available" stayed on screen. Same data, one more shape.
    //
    // `questions` is mirrored ONLY for a launchable session; a page of
    // completed history would otherwise carry every question twice.
    config: session.config || {},
    questions: lean || !launchable ? [] : questions,
    title:
      session.title ||
      session.config?.name ||
      session.config?.title ||
      null,
    status: sessionStatus,
    /** What a client may DO with it, independent of the db status. */
    availability: launchable
      ? sessionStatus === "paused"
        ? "paused"
        : "available"
      : session.end_time
        ? "completed"
        : "empty",
    session_kind: session.session_kind || "test",
    sessionKind: session.session_kind || "test",
    questionCount: questions.length || session.config?.numberOfQuestions || 0,
    /** Provenance for a quiz generated from a note (config.sourceNoteId). */
    sourceNoteId: session.config?.sourceNoteId ?? null,
    /**
     * The note's own title, persisted into config at creation and backfilled
     * on read when absent. The list prints "From <title>" under a note quiz,
     * so a missing field rendered the literal "From undefined" on device
     * (build 159). Always a string or null — never absent, never undefined.
     */
    sourceNoteTitle: normalizeSourceNoteTitle(session.config?.sourceNoteTitle),
    sourceDeckId: session.config?.sourceDeckId ?? null,
    sourceDeckTitle: normalizeSourceNoteTitle(session.config?.sourceDeckTitle),
    sourceJobId: session.config?.sourceJobId ?? null,
    /** @see buildTestProvenance — one object instead of four config lookups. */
    provenance: buildTestProvenance(session),
    start_time: session.start_time ?? null,
    end_time: session.end_time ?? null,
    // test_sessions has no `created_at` column: `start_time` (DEFAULT NOW()
    // on insert) is the row's creation date and what the list sorts by. Named
    // `created_at` because that is the field shipped clients read.
    created_at: session.start_time ?? session.updated_at ?? null,
    updated_at: session.updated_at ?? null,
    // ---------------------------------------------------------------
    session: {
      id: session.id,
      config: session.config || {},
      questions: lean ? [] : questions,
      userAnswers: lean ? {} : answers,
      currentQuestionIndex: session.current_question_index || 0,
      startTime: session.start_time
        ? new Date(session.start_time)
        : new Date(),
      endTime: session.end_time
        ? new Date(session.end_time)
        : undefined,
      isOffline: session.is_offline || false,
      sessionKind: session.session_kind || "test",
      status: sessionStatus,
      title: session.title || undefined,
      updatedAt: session.updated_at || undefined,
      pausedAt: session.paused_at || undefined,
      remainingTime: session.remaining_time_seconds ?? undefined,
    },
    score: result?.score || 0,
    totalQuestions:
      result?.total_questions ||
      questions.length ||
      0,
    correctAnswersCount: result?.correct_answers_count || 0,
    timeSpentSeconds,
    questionsWithTime,
  };
}
