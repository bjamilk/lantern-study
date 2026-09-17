/**
 * data/tests.ts — `test_sessions`, `test_results`, `test_templates`: the whole
 * life of a test, from draft to submitted attempt to the dashboards over it.
 *
 * ## Purpose
 *
 * Extracted verbatim from `services/supabase.ts` (monolith lane M1c, step 11):
 * the whole TESTS AND TEST SESSIONS section, 24 methods. The pure row→DTO
 * shapes it shares with the facade moved alongside it into
 * `data/testMappers.ts`.
 *
 * ## What it touches
 *
 * Tables: `test_sessions`, `test_results`, `test_templates`, `notes` and
 * `decks` (the source-title lookups only). No storage buckets, no RPCs.
 *
 * ## The gotchas
 *
 * 1. OWNERSHIP IS A PLAIN `data.user_id !== userId` CHECK ON EVERY READ, and
 *    the service role bypasses RLS, so removing one is a full-table read.
 *    `getTestById` makes that check INSIDE its cache loader, which is only
 *    safe because its cache key is per-user — the notifications banner in the
 *    facade records the version of this that was not, and had to be hotfixed.
 *    Do not copy the pattern to a loader with a shared key.
 *
 * 2. THERE ARE TWO CLIENT SHAPES AND BOTH ARE A CONTRACT.
 *    `mapTestSessionRowToClient` is one session; `mapTestListRow` (in
 *    `data/testMappers.ts`) is one row of the list. Mobile reads the flat
 *    fields and web reads the nested `session`, so a shape that satisfies only
 *    one of them is invisible on the other side.
 *
 * 3. THE DRAFT LIFECYCLE IS THE RESUME INVARIANT. A draft is
 *    created → updated → completed or abandoned, and what a client resumes is
 *    DERIVED from the stored row, not from anything it kept locally. That is
 *    why `updateTestDraft` writes `current_question_index` and
 *    `remaining_time_seconds` and why `completeTestDraft` is the only path
 *    that mints a result.
 *
 * 4. Topic and course are resolved BEFORE the write, against the course the
 *    row ends up with, and every write goes through `writeWithTopicFallback`
 *    so an unapplied 20260826120000 degrades rather than 42703s.
 *
 * ## Why the cross-method calls go back through `deps`
 *
 * Fourteen of these call a sibling (`startTest` → `getTestById`,
 * `completeTestDraft` → `createTestResult`, …) or a method still in the
 * monolith (`generateTestQuestions`, `calculateTestScore`, `updateUserStats`,
 * `applyTestCompletionGamification`, `resolveArtefactTopic`, `isGroupMember`).
 * None of them is wired as a local call: `routes/tests.*`,
 * `services/testProvenance.test.ts`, `testDraftLifecycle.test.ts` and
 * `learningEvents.test.ts` stub exactly these on a `SupabaseService` stand-in
 * and drive the entry point through `SupabaseService.prototype.<m>.call(self, …)`,
 * so a sibling call would step around the stub. The facade builds the `deps`
 * literal INLINE at each call site as arrows over `this`.
 *
 * `deps.recordTestSessionAnswers` is the learning-events writer, narrowed
 * (monolith lane M3, Phase B) from the whole `SupabaseService` it used to be
 * handed: this module names no facade now.
 */
import { logger } from "../../utils/logger";
import type { LearningSurface } from "@lantern/shared/learning";
import type { TestResult, User } from "../../types";
import { initialUserStats } from "@lantern/shared/utils/testHelpers";
import {
  coerceRawUserAnswers,
  sanitizeAnswerConfidences,
} from "@lantern/shared/utils/testHelpers";

import {
  applyCourseFilter,
  courseFilterKey,
  isMissingStudySetColumn,
  isMissingTopicColumn,
  type CourseFilter,
} from "../academicCourses";
import { cacheService } from "../cache";
import { recordTestSessionAnswers } from "../learningEvents";

import {
  resolveCourseIdFromConfigLike,
  resolveStudySetIdFromConfigLike,
  topicFilterApplies,
  writeWithTopicFallback,
} from "./academic";
import type { DataClient } from "./client";
import {
  buildAttemptTally,
  buildTestProvenance,
  mapTestListRow,
  normalizeSourceNoteTitle,
  topicIdOf,
} from "./testMappers";

/** Same alias the monolith uses: the shape of `profiles.stats`. */
type UserStats = typeof initialUserStats;

/**
 * Topic reference on the same payloads. Returned RAW, unlike the course above:
 * a topic id we cannot use must 400 in resolveForArtefact, not quietly vanish
 * into an artefact the student thinks they filed.
 *
 * Moved from `services/supabase.ts` module scope with the section (monolith
 * lane M1c, step 11): the two calls below were its only readers.
 */
function resolveTopicIdFromConfigLike(
  payload: { topicId?: unknown; config?: { topicId?: unknown } | null } | null | undefined,
): unknown {
  if (payload?.topicId !== undefined) return payload.topicId;
  return payload?.config?.topicId;
}

/**
 * Everything a moved body used to reach through `this`.
 *
 * Build this literal INLINE at each delegating call site, with arrows that
 * read `this.<method>` at CALL time. Hoisting it to an instance field compiles
 * and passes the surface freeze, but breaks every suite that invokes these
 * methods on a bare `{ supabase }` stand-in that never ran a constructor, and
 * bypasses every `jest.spyOn`.
 */
export type TestDeps = {
  /** The learning-events writer for a submitted session; never throws. */
  recordTestSessionAnswers: (
    params: Parameters<typeof recordTestSessionAnswers>[1],
  ) => Promise<{ inserted: number; skipped: boolean }>;
  getTestById: (testId: string, userId?: string) => Promise<any | null>;
  getUserTests: (userId: string, options?: any) => Promise<any>;
  attachSourceNoteTitles: <
    T extends { sourceNoteId?: string | null; sourceNoteTitle?: string | null },
  >(
    rows: T[],
    userId: string,
  ) => Promise<T[]>;
  mapTestSessionRowToClient: (session: any) => any;
  fetchNoteTitles: (
    noteIds: string[],
    userId: string,
  ) => Promise<Map<string, string>>;
  fetchDeckTitles: (
    deckIds: string[],
    userId: string,
  ) => Promise<Map<string, string>>;
  createTestResult: (
    testId: string,
    resultData: any,
    userId?: string,
    options?: { surface?: LearningSurface },
  ) => Promise<any>;
  deleteTest: (testId: string) => Promise<boolean>;
  /** Still in the monolith: group membership (data/groups.ts via the facade). */
  isGroupMember: (groupId: string, userId: string) => Promise<boolean>;
  /** Still in the monolith: academic filing. */
  resolveArtefactTopic: (input: {
    topicId?: unknown;
    courseId?: unknown;
    currentCourseId?: string | null;
  }) => Promise<string | null | undefined>;
  /**
   * In THIS module since monolith lane M3, still reached through `deps` for
   * the same reason as `updateUserStats`.
   */
  generateTestQuestions: (config: any) => any[];
  calculateTestScore: (questions: any[], answers: any[]) => number;
  /**
   * In THIS module since monolith lane M1h, but still reached through `deps`:
   * `supabase.submitTest*` harnesses stub it by name on a bare stand-in.
   */
  updateUserStats: (userId: string, score: number) => Promise<void>;
  /** Still in the monolith: gamification (lane M1c step 12 moves it). */
  applyTestCompletionGamification: (
    userId: string,
    activityDate?: string,
  ) => Promise<any>;
};

export async function getUserTests(
  supabase: DataClient,
  deps: TestDeps,
  userId: string,
  options: {
    page?: number;
    limit?: number;
    status?: string;
    /** Academic archive filter (test_sessions.course_id; unfiled → IS NULL, course → eq); replaces the dead config->>subject path. */
    courseFilter?: CourseFilter;
    /** Same, one level down (test_sessions.topic_id): unfiled → no topic in that course. */
    topicFilter?: CourseFilter;
    lean?: boolean;
    sort?: "newest" | "oldest" | "highestScore";
    from?: string;
    to?: string;
    /**
     * Only tests filed to this study set (test_sessions.study_set_id).
     *
     * It belongs in the QUERY, not in the caller. The route used to fetch one
     * page and filter it in JS, then report `total: filed.length` and
     * `hasMore: false` — so a set whose tests were older than the newest 20
     * lost them silently, and the count on screen was the count of whatever
     * happened to survive that page. Pushing it down here is what makes
     * pagination and `total` describe the same rows.
     */
    studySetId?: string;
  } = {},
): Promise<{ tests: any[]; total: number }> {
  const {
    page = 1,
    limit = 20,
    status,
    courseFilter,
    topicFilter,
    lean = false,
    sort = "newest",
    from,
    to,
    studySetId,
  } = options;
  const offset = (page - 1) * limit;
  const sortKey = sort || "newest";
  const fromKey = from || "";
  const toKey = to || "";

  // studySetId is part of the key: without it a filtered page and an
  // unfiltered one would share a cache entry and serve each other's rows.
  const cacheKey = `tests:${userId}:${page}:${limit}:${status || ""}:course:${courseFilterKey(courseFilter)}:topic:${courseFilterKey(topicFilter)}:set:${studySetId || ""}:${lean ? "lean" : "full"}:${sortKey}:${fromKey}:${toKey}`;

  return cacheService.cached(
    cacheKey,
    async () => {
      // Completed lean history only needs scores + config for charts, so omit
      // the questions so all-time pagination stays payload-light. user_answers
      // IS read, because the dashboard's "Avg / question" and total study time
      // are derived from per-answer timings — but it is folded into two numbers
      // below and never sent to the client, so the response stays lean.
      const completedLean = lean && status === "completed";
      const selectCols = lean
        ? `
        id,
        start_time,
        end_time,
        is_offline,
        config,
        course_id,
        status,
        session_kind,
        current_question_index,
        remaining_time_seconds,
        paused_at,
        updated_at,
        title,
        ${studySetId ? "study_set_id," : ""}
        ${completedLean ? "" : "questions,"}
        user_answers,
        test_results (
          score,
          correct_answers_count,
          total_questions
        )
      `
        : `
        *,
        test_results (
          score,
          correct_answers_count,
          total_questions
        )
      `;

      let query = supabase
        .from("test_sessions")
        .select(selectCols, { count: "exact" })
        .eq("user_id", userId);

      if (status === "completed") {
        query = query.eq("status", "completed");
      } else if (status === "paused") {
        query = query.eq("status", "paused");
      } else if (status === "in_progress") {
        query = query.in("status", ["in_progress", "paused"]);
      } else if (status === "not_started") {
        query = query.is("start_time", null);
      } else if (status === "abandoned") {
        query = query.eq("status", "abandoned");
      }

      query = applyCourseFilter(query, "course_id", courseFilter);
      query = applyCourseFilter(query, "topic_id", topicFilter);
      if (studySetId) {
        query = query.eq("study_set_id", studySetId);
      }

      if (from) {
        query = query.gte("start_time", from);
      }
      if (to) {
        query = query.lte("start_time", to);
      }

      const orderByUpdated =
        status === "paused" || status === "in_progress";
      if (sortKey === "oldest") {
        query = query.order(
          orderByUpdated ? "updated_at" : "start_time",
          { ascending: true },
        );
      } else if (sortKey === "highestScore") {
        // Prefer score from joined test_results; fall back below if PostgREST rejects the order.
        query = query
          .order("score", {
            referencedTable: "test_results",
            ascending: false,
            nullsFirst: false,
          })
          .order("start_time", { ascending: false });
      } else {
        query = query.order(
          orderByUpdated ? "updated_at" : "start_time",
          { ascending: false },
        );
      }

      let { data, error, count } = await query.range(
        offset,
        offset + limit - 1,
      );

      if (error && sortKey === "highestScore") {
        logger.warn("highestScore order failed; falling back to newest", {
          error: error.message,
        });
        let fallback = supabase
          .from("test_sessions")
          .select(selectCols, { count: "exact" })
          .eq("user_id", userId);
        if (status === "completed") fallback = fallback.eq("status", "completed");
        else if (status === "paused") fallback = fallback.eq("status", "paused");
        else if (status === "in_progress") {
          fallback = fallback.in("status", ["in_progress", "paused"]);
        } else if (status === "not_started")
          fallback = fallback.is("start_time", null);
        else if (status === "abandoned")
          fallback = fallback.eq("status", "abandoned");
        fallback = applyCourseFilter(fallback, "course_id", courseFilter);
        fallback = applyCourseFilter(fallback, "topic_id", topicFilter);
        if (studySetId) fallback = fallback.eq("study_set_id", studySetId);
        if (from) fallback = fallback.gte("start_time", from);
        if (to) fallback = fallback.lte("start_time", to);
        const retry = await fallback
          .order("start_time", { ascending: false })
          .range(offset, offset + limit - 1);
        data = retry.data;
        error = retry.error;
        count = retry.count;
        if (!error && Array.isArray(data)) {
          data = [...data].sort((a: any, b: any) => {
            const aScore = Array.isArray(a.test_results)
              ? a.test_results[0]?.score
              : a.test_results?.score;
            const bScore = Array.isArray(b.test_results)
              ? b.test_results[0]?.score
              : b.test_results?.score;
            return (bScore || 0) - (aScore || 0);
          });
        }
      }

      // Before 20260911120000_study_sets.sql no session can be filed to a
      // set, so a set filter matches nothing. Empty is the honest answer;
      // dropping the filter would hand back every test the user owns.
      if (error && studySetId && isMissingStudySetColumn(error)) {
        logger.warn(
          "study_set_id missing on test_sessions — set filter matched nothing (apply 20260911120000_study_sets.sql)",
        );
        return { tests: [], total: 0 };
      }

      if (error && topicFilterApplies(topicFilter) && isMissingTopicColumn(error)) {
        // No session can carry a topic before the migration: a named topic
        // matches nothing, and "no topic" matches every session.
        if (topicFilter?.kind === "course") return { tests: [], total: 0 };
        return deps.getUserTests(userId, { ...options, topicFilter: undefined });
      }

      if (error) throw error;

      const tests = (data || []).map((session: any) =>
        mapTestListRow(session, lean),
      );

      // Rows saved before the title was persisted at creation carry only
      // the note id. One batched query per page fills them in, and the
      // result is cached with the page, so this costs nothing on a hit.
      await deps.attachSourceNoteTitles(tests, userId);

      return {
        tests,
        total: typeof count === "number" ? count : tests.length,
      };
    },
    { ttl: 300 },
  );
}

export async function getTestById(
  supabase: DataClient,
  testId: string,
  userId?: string,
): Promise<any | null> {
  const cacheKey = userId
    ? `test:${testId}:user:${userId}`
    : `test:${testId}`;

  return cacheService.cached(
    cacheKey,
    async () => {
      const { data, error } = await supabase
        .from("test_sessions")
        .select("*")
        .eq("id", testId)
        .single();

      if (error) {
        if (error.code === "PGRST116") return null; // Not found
        throw error;
      }

      // Check if test belongs to user
      if (userId && data.user_id !== userId) {
        return null; // Access denied
      }

      return data;
    },
    { ttl: 600 },
  ); // Cache for 10 minutes
}

/**
 * The session row `userId` is allowed to read, and on what footing.
 *
 * `getTestById` answers only for the owner, which made GET /tests/:id a 404
 * for a group test another member launched — so a client that fell back to
 * it (a retake off a history row, which no longer carries questions) had
 * nowhere left to get the questions from and could only say "question data
 * is no longer available".
 *
 * Group access is READ-ONLY and deliberately narrower than ownership: it
 * grants the questions the group's bank produced, never another student's
 * answers. Callers must strip the attempt — see `sanitizeSessionForGroupPeer`.
 */
export async function resolveTestSessionForCaller(
  supabase: DataClient,
  deps: TestDeps,
  testId: string,
  userId: string,
): Promise<{ session: any; access: "owner" | "group" } | null> {
  const owned = await deps.getTestById(testId, userId);
  if (owned) return { session: owned, access: "owner" };

  // Not the owner. The only other readable case is a group session whose
  // group this caller belongs to; everything else stays a 404.
  const { data, error } = await supabase
    .from("test_sessions")
    .select("*")
    .eq("id", testId)
    .maybeSingle();
  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }
  if (!data) return null;

  const groupId = data.config?.groupId;
  if (typeof groupId !== "string" || !groupId) return null;
  if (!(await deps.isGroupMember(groupId, userId))) return null;

  return { session: data, access: "group" };
}

export async function createTest(
  supabase: DataClient,
  deps: TestDeps,
  testConfig: any,
  userId: string,
): Promise<any> {
  // Check if this is a completed test session (has questions and user_answers)
  const isCompletedSession =
    testConfig.questions && testConfig.questions.length > 0;

  const courseId = resolveCourseIdFromConfigLike(testConfig);
  // Topic is validated against the course this session is filed under, so a
  // wrong-course topic 400s before anything is written.
  const topicId = await deps.resolveArtefactTopic({
    topicId: resolveTopicIdFromConfigLike(testConfig),
    courseId,
  });

  /**
   * The set this session was taken in.
   *
   * Read from the top-level field OR from the config, because the config is
   * what every client create path already sends and the two doors must file
   * a session the same way. Without this, `POST /tests` wrote no
   * `study_set_id` at all: live, all 77 of an account's sessions had none,
   * so every set room's Test tab — which lists by set — was permanently
   * empty. `writeWithTopicFallback` drops the column if the study-sets
   * migration has not been applied yet.
   */
  const studySetId = resolveStudySetIdFromConfigLike(testConfig);

  const insertData: any = {
    user_id: userId,
    course_id: courseId,
    ...(topicId !== undefined ? { topic_id: topicId } : {}),
    ...(studySetId ? { study_set_id: studySetId } : {}),
  };

  if (isCompletedSession) {
    // This is a completed test being saved
    insertData.config = testConfig.config || testConfig;
    insertData.questions = testConfig.questions || [];
    insertData.user_answers = testConfig.user_answers || {};
    insertData.start_time = testConfig.start_time;
    insertData.end_time = testConfig.end_time;
    insertData.is_offline = testConfig.is_offline || false;
    insertData.status = "completed";
    insertData.session_kind = testConfig.session_kind || testConfig.sessionKind || "test";
    insertData.title = testConfig.title || null;
    insertData.current_question_index =
      typeof testConfig.current_question_index === "number"
        ? testConfig.current_question_index
        : 0;
    insertData.updated_at = new Date().toISOString();
  } else {
    // This is a new test configuration
    insertData.config = testConfig;
    insertData.questions = [];
    insertData.user_answers = {};
    insertData.status = "in_progress";
    insertData.session_kind = "test";
    insertData.updated_at = new Date().toISOString();
  }

  const { data, error } = await writeWithTopicFallback(
    (row) => supabase.from("test_sessions").insert(row).select().single(),
    insertData,
  );

  if (error) throw error;

  // Invalidate caches
  await cacheService.deletePattern(`tests:${userId}:*`);

  return data;
}

/**
 * Create a personal, not-yet-started test from a set of questions — the shape
 * "Available Tests" lists (questions present, no end_time, status
 * in_progress).
 *
 * POST /tests cannot express this: it treats any payload carrying questions
 * as a COMPLETED session, so a quiz generated from a note had nowhere to be
 * saved as a launchable test.
 */
export async function createPersonalTest(
  supabase: DataClient,
  deps: TestDeps,
  payload: {
    title: string;
    questions: any[];
    sourceNoteId?: string | null;
    /** Deck the questions were drawn from — the deck→test path. */
    sourceDeckId?: string | null;
    sourceJobId?: string | null;
    courseId?: string | null;
    topicId?: string | null;
    studySetId?: string | null;
    config?: Record<string, any> | null;
  },
  userId: string,
): Promise<any> {
  const courseId =
    typeof payload.courseId === "string" && payload.courseId ? payload.courseId : null;
  const topicId = await deps.resolveArtefactTopic({
    topicId: payload.topicId,
    courseId,
  });

  const sourceNoteId =
    typeof payload.sourceNoteId === "string" && payload.sourceNoteId
      ? payload.sourceNoteId
      : null;
  // Resolve the note's title ONCE, here, so every later read is a plain
  // config read. The client prints "From <title>" under a note quiz; without
  // this the field was absent and the list rendered "From undefined".
  // A client-supplied title is only a fallback, and only for a note the
  // caller actually linked: it is never trusted over the note's own row.
  const sourceNoteTitle = sourceNoteId
    ? (await deps.fetchNoteTitles([sourceNoteId], userId)).get(sourceNoteId) ??
      normalizeSourceNoteTitle((payload.config as any)?.sourceNoteTitle)
    : null;

  // Same rule as the note above, one source over: the deck's OWN name wins
  // over anything the client sent, and is resolved once at creation so every
  // later read is a plain config read.
  const sourceDeckId =
    typeof payload.sourceDeckId === "string" && payload.sourceDeckId
      ? payload.sourceDeckId
      : null;
  const sourceDeckTitle = sourceDeckId
    ? ((await deps.fetchDeckTitles([sourceDeckId], userId)).get(sourceDeckId) ??
      normalizeSourceNoteTitle((payload.config as any)?.sourceDeckTitle))
    : null;

  const config = {
    ...(payload.config && typeof payload.config === "object" ? payload.config : {}),
    title: payload.title,
    // The mobile Tests list names a session from `config.name` (then
    // `testName`); without it a refetch renamed every note quiz "Untitled
    // Test" the moment it left the client-side insert behind.
    name: payload.title,
    numberOfQuestions: payload.questions.length,
    courseId,
    // Provenance lives in config, not a column: no migration is needed for
    // the note link, and the client reads it straight back off the session.
    ...(sourceNoteId ? { sourceNoteId } : {}),
    // Always written, so a client-supplied value can never outlive the
    // resolved one (or survive on a test that links to no note at all).
    sourceNoteTitle,
    ...(sourceDeckId ? { sourceDeckId } : {}),
    sourceDeckTitle,
    ...(payload.sourceJobId ? { sourceJobId: payload.sourceJobId } : {}),
    source: sourceNoteId
      ? "note"
      : sourceDeckId
        ? "deck"
        : (payload.config as any)?.source || "personal",
  };

  const studySetId =
    typeof payload.studySetId === "string" && payload.studySetId ? payload.studySetId : null;

  const { data, error } = await writeWithTopicFallback(
    (row) => supabase.from("test_sessions").insert(row).select().single(),
    {
      user_id: userId,
      course_id: courseId,
      ...(topicId !== undefined ? { topic_id: topicId } : {}),
      ...(studySetId ? { study_set_id: studySetId } : {}),
      config,
      questions: payload.questions,
      user_answers: {},
      // No end_time and a non-empty question list is exactly what the mobile
      // Tests list filters for; anything else would silently not appear.
      status: "in_progress",
      session_kind: "test",
      title: payload.title,
      current_question_index: 0,
      is_offline: false,
      updated_at: new Date().toISOString(),
    },
  );

  if (error) throw error;

  await cacheService.deletePattern(`tests:${userId}:*`);

  return data;
}

export function mapTestSessionRowToClient(
  supabase: DataClient,
  session: any,
) {
  const questions = Array.isArray(session.questions) ? session.questions : [];
  // Legacy submit stored Object.values(userAnswers) as a JSON array; draft
  // complete stores a Record. Coerce both so history hydrate keeps answers.
  const answers = coerceRawUserAnswers(
    session.user_answers ?? session.userAnswers,
    questions,
  );
  return {
    id: session.id,
    config: session.config || {},
    courseId: session.course_id ?? session.config?.courseId ?? null,
    studySetId: session.study_set_id ?? session.config?.studySetId ?? null,
    ...topicIdOf(session),
    questions,
    userAnswers: answers,
    currentQuestionIndex: session.current_question_index || 0,
    startTime: session.start_time ? new Date(session.start_time) : new Date(),
    endTime: session.end_time ? new Date(session.end_time) : undefined,
    remainingTime:
      typeof session.remaining_time_seconds === "number"
        ? session.remaining_time_seconds
        : undefined,
    isOffline: session.is_offline || false,
    sessionKind: session.session_kind || "test",
    status: session.status || "in_progress",
    title: session.title || undefined,
    updatedAt: session.updated_at || undefined,
    pausedAt: session.paused_at || undefined,
    userId: session.user_id,
    // Everything a launch needs without a second read: how many questions
    // there are, and where the test came from. `sourceNoteId` is how a
    // generated quiz links back to the note that produced it.
    questionCount: questions.length || session.config?.numberOfQuestions || 0,
    sourceNoteId: session.config?.sourceNoteId ?? null,
    /** @see mapTestListRow — same contract: a string or null, never absent. */
    sourceNoteTitle: normalizeSourceNoteTitle(session.config?.sourceNoteTitle),
    sourceDeckId: session.config?.sourceDeckId ?? null,
    sourceDeckTitle: normalizeSourceNoteTitle(session.config?.sourceDeckTitle),
    sourceJobId: session.config?.sourceJobId ?? null,
    /**
     * Resolved source of the session — {noteId, deckId, groupId, title}, each
     * a string or null. This is what a retake reads to name what it is
     * relaunching; it never has to parse `config` itself.
     */
    provenance: buildTestProvenance(session),
  };
}

/**
 * The titles of `noteIds` this user owns, as an id → title map. One query,
 * whatever the page size; ids with no readable note are simply absent.
 * Never throws: a missing title degrades the "From <note>" line, it does
 * not fail the test list.
 */
export async function fetchNoteTitles(
  supabase: DataClient,
  noteIds: string[],
  userId: string,
): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  const ids = Array.from(
    new Set(noteIds.filter((id): id is string => typeof id === "string" && !!id)),
  );
  if (ids.length === 0 || !userId) return titles;
  try {
    const { data, error } = await supabase
      .from("notes")
      .select("id, title")
      .eq("user_id", userId)
      .in("id", ids);
    if (error) throw error;
    for (const note of (data || []) as any[]) {
      const title = normalizeSourceNoteTitle(note?.title);
      if (note?.id && title) titles.set(String(note.id), title);
    }
  } catch (err) {
    logger.warn("Could not resolve source note titles", {
      userId,
      count: ids.length,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return titles;
}

/**
 * The names of `deckIds` this user owns, as an id → name map. Same contract
 * as `fetchNoteTitles`: one query, never throws, ids with no readable deck
 * are simply absent (a missing name degrades "From <deck>", it does not fail
 * the save).
 */
export async function fetchDeckTitles(
  supabase: DataClient,
  deckIds: string[],
  userId: string,
): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  const ids = Array.from(
    new Set(deckIds.filter((id): id is string => typeof id === "string" && !!id)),
  );
  if (ids.length === 0 || !userId) return titles;
  try {
    const { data, error } = await supabase
      .from("decks")
      .select("id, name")
      .eq("user_id", userId)
      .in("id", ids);
    if (error) throw error;
    for (const deck of (data || []) as any[]) {
      const title = normalizeSourceNoteTitle(deck?.name);
      if (deck?.id && title) titles.set(String(deck.id), title);
    }
  } catch (err) {
    logger.warn("Could not resolve source deck titles", {
      userId,
      count: ids.length,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return titles;
}

/**
 * The display title of a source a personal test is about to be created from
 * — a note or a deck this caller owns — or null. Used to default the test's
 * title when the client sends none.
 */
export async function resolvePersonalTestSourceTitle(
  supabase: DataClient,
  deps: TestDeps,
  source: { noteId?: string | null; deckId?: string | null },
  userId: string,
): Promise<string | null> {
  if (typeof source.noteId === "string" && source.noteId) {
    const found = (await deps.fetchNoteTitles([source.noteId], userId)).get(source.noteId);
    if (found) return found;
  }
  if (typeof source.deckId === "string" && source.deckId) {
    const found = (await deps.fetchDeckTitles([source.deckId], userId)).get(source.deckId);
    if (found) return found;
  }
  return null;
}

/**
 * Backfill `sourceNoteTitle` on mapped test rows written before the title
 * was persisted at creation. One batched note query per page, and only for
 * the rows that actually link to a note and lack a title.
 */
export async function attachSourceNoteTitles<
  T extends { sourceNoteId?: string | null; sourceNoteTitle?: string | null },
>(
  supabase: DataClient,
  deps: TestDeps,
  rows: T[],
  userId: string,
): Promise<T[]> {
  const missing = rows.filter(
    (row) =>
      row &&
      typeof row.sourceNoteId === "string" &&
      !!row.sourceNoteId &&
      !row.sourceNoteTitle,
  );
  if (missing.length === 0) return rows;
  const titles = await deps.fetchNoteTitles(
    missing.map((row) => row.sourceNoteId as string),
    userId,
  );
  for (const row of missing) {
    row.sourceNoteTitle = titles.get(row.sourceNoteId as string) ?? null;
  }
  return rows;
}

export async function createTestDraft(
  supabase: DataClient,
  deps: TestDeps,
  payload: {
    config: any;
    /** Academic archive reference; also mirrored into config.courseId by the route. */
    courseId?: string | null;
    /** Topic within `courseId`; rejected (400) if it belongs to another course. */
    topicId?: string | null;
    questions: any[];
    user_answers?: Record<string, any>;
    start_time?: string;
    session_kind?: "test" | "study";
    title?: string;
    current_question_index?: number;
    remaining_time_seconds?: number | null;
    is_offline?: boolean;
    client_id?: string;
    /** Set room the session was started in; also read off `config`. */
    studySetId?: string | null;
  },
  userId: string,
): Promise<any> {
  const now = new Date().toISOString();
  const courseId = resolveCourseIdFromConfigLike(payload);
  // A paused session belongs to the room it was started in, exactly as a
  // finished one does — otherwise resuming it would move it out of the set.
  const studySetId = resolveStudySetIdFromConfigLike(payload);
  const topicId = await deps.resolveArtefactTopic({
    topicId: resolveTopicIdFromConfigLike(payload),
    courseId,
  });
  const insertData: any = {
    user_id: userId,
    config: payload.config || {},
    course_id: courseId,
    ...(topicId !== undefined ? { topic_id: topicId } : {}),
    ...(studySetId ? { study_set_id: studySetId } : {}),
    questions: Array.isArray(payload.questions) ? payload.questions : [],
    user_answers: payload.user_answers || {},
    start_time: payload.start_time || now,
    end_time: null,
    is_offline: payload.is_offline || false,
    status: "in_progress",
    session_kind: payload.session_kind === "study" ? "study" : "test",
    current_question_index: Math.max(0, payload.current_question_index || 0),
    remaining_time_seconds:
      typeof payload.remaining_time_seconds === "number"
        ? payload.remaining_time_seconds
        : null,
    title: payload.title || null,
    updated_at: now,
    paused_at: null,
  };

  const { data, error } = await writeWithTopicFallback(
    (row) => supabase.from("test_sessions").insert(row).select().single(),
    insertData,
  );

  if (error) throw error;
  await cacheService.deletePattern(`tests:${userId}:*`);
  return deps.mapTestSessionRowToClient(data);
}

export async function updateTestDraft(
  supabase: DataClient,
  deps: TestDeps,
  draftId: string,
  userId: string,
  updates: {
    user_answers?: Record<string, any>;
    current_question_index?: number;
    remaining_time_seconds?: number | null;
    status?: "in_progress" | "paused";
    title?: string;
    config?: Record<string, unknown>;
  },
): Promise<any | null> {
  const existing = await deps.getTestById(draftId, userId);
  if (!existing) return null;
  if (existing.status === "completed" || existing.status === "abandoned") {
    throw new Error("Cannot update a finished session");
  }
  if (existing.end_time) {
    throw new Error("Cannot update a finished session");
  }

  const now = new Date().toISOString();
  const patch: any = { updated_at: now };
  // Answers pass through untouched EXCEPT `confidence`, which is validated
  // down to 'sure' | 'unsure' or removed. An unrecognised value stored here
  // would be read back as a confidence level of its own by every analysis.
  if (updates.user_answers !== undefined) {
    patch.user_answers = sanitizeAnswerConfidences(updates.user_answers);
  }
  if (typeof updates.current_question_index === "number") {
    patch.current_question_index = Math.max(0, updates.current_question_index);
  }
  if (updates.remaining_time_seconds !== undefined) {
    patch.remaining_time_seconds = updates.remaining_time_seconds;
  }
  if (updates.title !== undefined) patch.title = updates.title;
  if (updates.config && typeof updates.config === "object" && !Array.isArray(updates.config)) {
    const existingConfig =
      existing.config && typeof existing.config === "object" && !Array.isArray(existing.config)
        ? existing.config
        : {};
    patch.config = { ...existingConfig, ...updates.config };
  }
  if (updates.status === "paused") {
    patch.status = "paused";
    patch.paused_at = now;
  } else if (updates.status === "in_progress") {
    patch.status = "in_progress";
    patch.paused_at = null;
  }

  const { data, error } = await supabase
    .from("test_sessions")
    .update(patch)
    .eq("id", draftId)
    .eq("user_id", userId)
    .in("status", ["in_progress", "paused"])
    .is("end_time", null)
    .select()
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  await cacheService.delete(`test:${draftId}`);
  await cacheService.delete(`test:${draftId}:user:${userId}`);
  await cacheService.deletePattern(`tests:${userId}:*`);
  return deps.mapTestSessionRowToClient(data);
}

export async function completeTestDraft(
  supabase: DataClient,
  deps: TestDeps,
  draftId: string,
  userId: string,
  options?: {
    user_answers?: Record<string, any>;
    activityDate?: string;
    score?: number;
    correctAnswersCount?: number;
    totalQuestions?: number;
    /** Merge into session config before completing (fixes mobile draft groupId). */
    config?: Record<string, unknown>;
    /** 'web' | 'mobile' from x-lantern-surface (learning_events.surface); default 'api'. */
    surface?: LearningSurface;
  },
): Promise<any> {
  const existing = await deps.getTestById(draftId, userId);
  if (!existing) throw new Error("Session not found");
  if (existing.status === "completed") {
    throw new Error("Session already completed");
  }
  if (existing.status === "abandoned") {
    throw new Error("Session was abandoned");
  }

  const now = new Date().toISOString();
  const answers = sanitizeAnswerConfidences(
    options?.user_answers ?? existing.user_answers ?? {},
  );
  const sessionKind = existing.session_kind === "study" ? "study" : "test";
  const existingConfig =
    existing.config && typeof existing.config === "object" && !Array.isArray(existing.config)
      ? existing.config
      : {};
  const configPatch =
    options?.config && typeof options.config === "object" && !Array.isArray(options.config)
      ? options.config
      : null;
  const nextConfig = configPatch ? { ...existingConfig, ...configPatch } : existingConfig;

  const { data, error } = await supabase
    .from("test_sessions")
    .update({
      user_answers: answers,
      end_time: now,
      status: "completed",
      updated_at: now,
      remaining_time_seconds: null,
      paused_at: null,
      ...(configPatch ? { config: nextConfig } : {}),
    })
    .eq("id", draftId)
    .eq("user_id", userId)
    .in("status", ["in_progress", "paused"])
    .is("end_time", null)
    .select()
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Session already completed");

  await cacheService.delete(`test:${draftId}`);
  await cacheService.delete(`test:${draftId}:user:${userId}`);

  if (sessionKind === "study") {
    // Study sessions still affect lean history lists / draft caches.
    await cacheService.deletePattern(`tests:${userId}:*`);
    // learning_events: study sessions never reach createTestResult, so emit
    // their question_answered rows here (same once-per-session guard).
    await deps.recordTestSessionAnswers({
      session: data,
      userId,
      surface: options?.surface ?? "api",
    });
    return {
      session: deps.mapTestSessionRowToClient(data),
      sessionKind: "study",
      score: null,
      totalQuestions: Array.isArray(data.questions) ? data.questions.length : 0,
      correctAnswersCount: null,
    };
  }

  // createTestResult invalidates tests:${userId}:* after the score row lands.
  const result = await deps.createTestResult(
    draftId,
    {
      score: options?.score ?? 0,
      correctAnswersCount: options?.correctAnswersCount ?? 0,
      totalQuestions:
        options?.totalQuestions ??
        (Array.isArray(data.questions) ? data.questions.length : 0),
      activityDate: options?.activityDate,
    },
    userId,
    { surface: options?.surface ?? "api" },
  );

  return {
    session: deps.mapTestSessionRowToClient(data),
    sessionKind: "test",
    ...result,
  };
}

export async function abandonTestDraft(
  supabase: DataClient,
  draftId: string,
  userId: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("test_sessions")
    .update({
      status: "abandoned",
      updated_at: now,
      remaining_time_seconds: null,
    })
    .eq("id", draftId)
    .eq("user_id", userId)
    .in("status", ["in_progress", "paused"])
    .is("end_time", null)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  await cacheService.delete(`test:${draftId}`);
  await cacheService.delete(`test:${draftId}:user:${userId}`);
  await cacheService.deletePattern(`tests:${userId}:*`);
  return !!data;
}

export async function startTest(
  supabase: DataClient,
  deps: TestDeps,
  testId: string,
  userId: string,
): Promise<any | null> {
  // Get test first
  const test = await deps.getTestById(testId, userId);
  if (!test) return null;

  // Check if test has already been started (has questions)
  if (test.questions && test.questions.length > 0) {
    throw new Error("Test has already been started");
  }

  // Generate questions based on config (simplified - in real app this would be more complex)
  const questions = deps.generateTestQuestions(test.config);

  // RC-04: only the first start wins; empty questions array is the CAS precondition.
  const { data, error } = await supabase
    .from("test_sessions")
    .update({
      start_time: new Date().toISOString(),
      questions,
    })
    .eq("id", testId)
    .eq("user_id", userId)
    .eq("questions", [])
    .select()
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    // Bypass stale pre-start cache from the concurrent loser path.
    await cacheService.delete(`test:${testId}`);
    await cacheService.delete(`test:${testId}:user:${userId}`);
    const existing = await deps.getTestById(testId, userId);
    if (existing?.questions && existing.questions.length > 0) {
      return existing;
    }
    throw new Error("Test has already been started");
  }

  // Invalidate caches
  await cacheService.delete(`test:${testId}`);
  await cacheService.delete(`test:${testId}:user:${userId}`);
  await cacheService.deletePattern(`tests:${userId}:*`);

  return data;
}

export async function submitTest(
  supabase: DataClient,
  deps: TestDeps,
  testId: string,
  userId: string,
  answers: any[],
): Promise<any> {
  // Get test first
  const test = await deps.getTestById(testId, userId);
  if (!test) throw new Error("Test not found");

  // Calculate score
  const score = deps.calculateTestScore(test.questions, answers);
  const correctAnswers = Math.round((score / 100) * test.questions.length);

  // Atomic complete: only the first concurrent submit wins (CONC-02).
  const { data, error } = await supabase
    .from("test_sessions")
    .update({
      end_time: new Date().toISOString(),
      // Array form preserved; only `confidence` is validated. @see sanitizeAnswerConfidences
      user_answers: sanitizeAnswerConfidences(answers),
      status: "completed",
      updated_at: new Date().toISOString(),
      remaining_time_seconds: null,
      paused_at: null,
    })
    .eq("id", testId)
    .eq("user_id", userId)
    .is("end_time", null)
    .select()
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new Error("Test has already been completed");
  }

  // Upsert result — UNIQUE(session_id) prevents duplicates under races.
  const { error: resultError } = await supabase
    .from("test_results")
    .upsert(
      {
        session_id: testId,
        score,
        total_questions: test.questions.length,
        correct_answers_count: correctAnswers,
      },
      { onConflict: "session_id", ignoreDuplicates: true },
    );

  if (resultError) throw resultError;

  // Update user stats
  await deps.updateUserStats(userId, score);

  // Invalidate caches
  await cacheService.delete(`test:${testId}`);
  await cacheService.deletePattern(`tests:${userId}:*`);
  await cacheService.delete(`user:stats:${userId}`);

  return {
    test: data,
    score,
    totalQuestions: test.questions.length,
    correctAnswers,
  };
}

export async function createTestResult(
  supabase: DataClient,
  deps: TestDeps,
  testId: string,
  resultData: {
    score: number;
    correctAnswersCount: number;
    totalQuestions: number;
    activityDate?: string;
  },
  userId?: string,
  options: {
    /** 'web' | 'mobile' from x-lantern-surface (learning_events.surface); default 'api'. */
    surface?: LearningSurface;
  } = {},
): Promise<any> {
  let score = resultData.score;
  let correctAnswersCount = resultData.correctAnswersCount;
  let totalQuestions = resultData.totalQuestions;

  const test = userId
    ? await deps.getTestById(testId, userId)
    : await deps.getTestById(testId);
  if (test?.questions?.length && test.user_answers?.length) {
    score = deps.calculateTestScore(test.questions, test.user_answers);
    totalQuestions = test.questions.length;
    correctAnswersCount = Math.round((score / 100) * totalQuestions);
  }

  const { data, error } = await supabase
    .from("test_results")
    .upsert(
      {
        session_id: testId,
        score,
        correct_answers_count: correctAnswersCount,
        total_questions: totalQuestions,
      },
      { onConflict: "session_id" },
    )
    .select()
    .single();

  if (error) throw error;

  // learning_events: one question_answered per attempted answer. This is the
  // single function both completion paths call (completeTestDraft and
  // POST /tests/:id/results), and recordTestSessionAnswers dedupes on
  // (user_id, session_id) so a session never emits twice. Never throws.
  const eventUserId = userId || (test?.user_id as string | undefined);
  if (test && eventUserId) {
    await deps.recordTestSessionAnswers({
      session: test,
      userId: eventUserId,
      surface: options.surface ?? "api",
    });
  }

  // Invalidate caches. Dashboard Group Performance is built from lean completed
  // history (`tests:${userId}:*` / `/dashboard/summary`), so drop those AFTER
  // the result row exists — earlier deletes race with a refill that still
  // lacks score/correctAnswersCount.
  await cacheService.delete(`test:results:${testId}`);
  if (userId) {
    await cacheService.deletePattern(`tests:${userId}:*`);
    await cacheService.deletePattern(`tests:stats:performance:${userId}:*`);
    await cacheService.delete(`tests:stats:subject:${userId}`);
  }

  let gamification:
    | {
        points: number;
        badges: User["badges"];
        stats: UserStats;
        awardedBadges: User["badges"];
      }
    | undefined;
  if (userId) {
    try {
      gamification = await deps.applyTestCompletionGamification(
        userId,
        resultData.activityDate,
      );
      await cacheService.invalidateUserCache(userId);
    } catch (err) {
      logger.warn("Test result gamification sync failed", {
        userId,
        testId,
        err,
      });
    }
  }

  return gamification ? { ...data, gamification } : data;
}

export async function getTestResults(
  supabase: DataClient,
  deps: TestDeps,
  testId: string,
  userId?: string,
): Promise<any | null> {
  const cacheKey = `test:results:${testId}`;

  return cacheService.cached(
    cacheKey,
    async () => {
      const { data, error } = await supabase
        .from("test_results")
        .select("*")
        .eq("session_id", testId)
        .single();

      if (error) {
        if (error.code === "PGRST116") return null; // Not found
        throw error;
      }

      // Check access if userId provided
      const test = userId
        ? await deps.getTestById(testId, userId)
        : await deps.getTestById(testId);
      if (userId && !test) return null;

      // `correct_answers_count` alone cannot tell a client whether the rest
      // were wrong or never reached, so every results screen guessed
      // (total - correct) and called them all missed. The tally splits the
      // three apart, and carries the confidence the student reported.
      return { ...data, tally: buildAttemptTally(test) };
    },
    { ttl: 1800 },
  ); // Cache for 30 minutes
}

export async function getTestQuestions(
  supabase: DataClient,
  deps: TestDeps,
  testId: string,
  userId?: string,
): Promise<any[]> {
  const cacheKey = `test:questions:${testId}`;

  return cacheService.cached(
    cacheKey,
    async () => {
      const test = await deps.getTestById(testId, userId);
      if (!test) return [];

      return test.questions || [];
    },
    { ttl: 1800 },
  ); // Cache for 30 minutes
}

export async function deleteTest(
  supabase: DataClient,
  testId: string
): Promise<boolean> {
  // Delete test results first
  const { error: resultsError } = await supabase
    .from("test_results")
    .delete()
    .eq("session_id", testId);

  if (resultsError) throw resultsError;

  // Delete the test session
  const { error } = await supabase
    .from("test_sessions")
    .delete()
    .eq("id", testId);

  if (error) throw error;

  // Invalidate caches
  await cacheService.delete(`test:${testId}`);
  await cacheService.delete(`test:results:${testId}`);
  await cacheService.delete(`test:questions:${testId}`);
  await cacheService.deletePattern(`tests:*`);

  return true;
}

export async function deleteCompletedTestSession(
  supabase: DataClient,
  deps: TestDeps,
  sessionId: string,
  userId: string,
): Promise<boolean> {
  const { data: session, error: fetchError } = await supabase
    .from("test_sessions")
    .select("id, user_id, end_time")
    .eq("id", sessionId)
    .maybeSingle();

  if (fetchError) throw fetchError;
  if (!session || session.user_id !== userId) return false;
  if (!session.end_time) {
    throw new Error("Cannot delete an in-progress test session");
  }

  return deps.deleteTest(sessionId);
}

export async function clearCompletedTestHistory(
  supabase: DataClient,
  userId: string
): Promise<number> {
  const { data: sessions, error } = await supabase
    .from("test_sessions")
    .select("id")
    .eq("user_id", userId)
    .not("end_time", "is", null);

  if (error) throw error;
  if (!sessions?.length) return 0;

  const sessionIds = sessions.map((row: { id: string }) => row.id);

  const { error: resultsError } = await supabase
    .from("test_results")
    .delete()
    .in("session_id", sessionIds);

  if (resultsError) throw resultsError;

  const { error: sessionsError } = await supabase
    .from("test_sessions")
    .delete()
    .in("id", sessionIds);

  if (sessionsError) throw sessionsError;

  for (const sessionId of sessionIds) {
    await cacheService.delete(`test:${sessionId}`);
    await cacheService.delete(`test:results:${sessionId}`);
    await cacheService.delete(`test:questions:${sessionId}`);
  }
  await cacheService.deletePattern(`tests:${userId}:*`);
  await cacheService.delete(`user:${userId}:test-results`);
  await cacheService.delete(`tests:stats:subject:${userId}`);
  await cacheService.deletePattern(`tests:stats:performance:${userId}:*`);
  await cacheService.delete(`user:stats:${userId}`);

  return sessionIds.length;
}

export async function getSubjectStats(
  supabase: DataClient,
  userId: string
): Promise<any> {
  const cacheKey = `tests:stats:subject:${userId}`;

  return cacheService.cached(
    cacheKey,
    async () => {
      const { data, error } = await supabase
        .from("test_sessions")
        .select(
          `
        config,
        course_id,
        test_results (score)
      `,
        )
        .eq("user_id", userId)
        .not("end_time", "is", null); // Only completed tests

      if (error) throw error;

      // Group by course (test_sessions.course_id; label = course code).
      // Sessions without a course fall into "General". config.subject was
      // never written by any client, so it is no longer consulted.
      const courseIds = Array.from(
        new Set(
          (data || [])
            .map((test: any) => test.course_id ?? test.config?.courseId)
            .filter((id: unknown): id is string => typeof id === "string" && id.length > 0),
        ),
      );
      const courseLabels = new Map<string, string>();
      if (courseIds.length > 0) {
        const { data: courseRows, error: courseError } = await supabase
          .from("courses")
          .select("id, code")
          .in("id", courseIds);
        if (!courseError && courseRows) {
          for (const row of courseRows as Array<{ id: string; code: string }>) {
            courseLabels.set(row.id, row.code);
          }
        }
      }

      const subjectStats: { [key: string]: any } = {};
      data?.forEach((test: any) => {
        const courseId: string | null =
          test.course_id ?? test.config?.courseId ?? null;
        const subject =
          (courseId && courseLabels.get(courseId)) || "General";
        const key = courseId && courseLabels.has(courseId) ? courseId : "general";
        const score = test.test_results?.[0]?.score;
        if (score !== undefined) {
          if (!subjectStats[key]) {
            subjectStats[key] = {
              subject,
              courseId: courseId && courseLabels.has(courseId) ? courseId : null,
              testsTaken: 0,
              averageScore: 0,
              scores: [],
            };
          }
          subjectStats[key].testsTaken++;
          subjectStats[key].scores.push(score);
        }
      });

      // Calculate averages
      Object.values(subjectStats).forEach((stats: any) => {
        stats.averageScore =
          stats.scores.reduce(
            (sum: number, score: number) => sum + score,
            0,
          ) / stats.scores.length;
        delete stats.scores;
      });

      return Object.values(subjectStats);
    },
    { ttl: 600 },
  ); // Cache for 10 minutes
}

export async function getPerformanceStats(
  supabase: DataClient,
  userId: string,
  period: string = "month",
): Promise<any> {
  const cacheKey = `tests:stats:performance:${userId}:${period}`;

  return cacheService.cached(
    cacheKey,
    async () => {
      // Calculate date range based on period
      const now = new Date();
      let startDate: Date;

      switch (period) {
        case "week":
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case "month":
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case "year":
          startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
          break;
        default:
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }

      const { data, error } = await supabase
        .from("test_sessions")
        .select(
          `
        start_time,
        test_results (score)
      `,
        )
        .eq("user_id", userId)
        .not("end_time", "is", null) // Only completed tests
        .gte("start_time", startDate.toISOString());

      if (error) throw error;

      const scores =
        data
          ?.map((test: any) => test.test_results?.[0]?.score)
          .filter((score) => score !== undefined) || [];
      const averageScore =
        scores.length > 0
          ? scores.reduce((sum, score) => sum + score, 0) / scores.length
          : 0;

      return {
        period,
        testsTaken: scores.length,
        averageScore: Math.round(averageScore * 100) / 100,
        highestScore: scores.length > 0 ? Math.max(...scores) : 0,
        lowestScore: scores.length > 0 ? Math.min(...scores) : 0,
      };
    },
    { ttl: 300 },
  ); // Cache for 5 minutes
}

export async function getTestTemplates(
  supabase: DataClient,
  options: {
    page?: number;
    limit?: number;
    subject?: string;
    difficulty?: string;
  } = {},
): Promise<any[]> {
  const { page = 1, limit = 20, subject, difficulty } = options;
  const offset = (page - 1) * limit;

  const cacheKey = `tests:templates:${page}:${limit}:${subject || ""}:${difficulty || ""}`;

  return cacheService.cached(
    cacheKey,
    async () => {
      let query = supabase.from("test_templates").select("*");

      if (subject) {
        query = query.eq("subject", subject);
      }

      if (difficulty) {
        query = query.eq("difficulty", difficulty);
      }

      const { data, error } = await query
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      return data || [];
    },
    { ttl: 1800 },
  ); // Cache for 30 minutes
}


// ============================================================================
// TEST-RESULT HISTORY AND THE PROFILE TEST-STATS AGGREGATE
// ----------------------------------------------------------------------------
// Moved verbatim out of `services/supabase.ts` (monolith lane M1h) — the last
// two query-bearing methods of the tests domain in that file.
//
// `updateUserStats` writes `profiles.stats`, a table the gamification
// repository otherwise owns, but it lives HERE because it is test bookkeeping
// and nothing else calls it: `submitTest` above is its only caller, it already
// declared it in `TestDeps`, and the aggregate it maintains (testsTaken /
// totalScore / averageScore) is the test history, not points, badges, levels or
// streaks. It keeps going through `deps` so the submit-path harnesses that stub
// it by name still intercept.
// ============================================================================

// Test Results Functions
export async function fetchTestResults(
  db: DataClient,
  userId: string,
): Promise<TestResult[]> {
  const cacheKey = `user:${userId}:test-results`;

  return cacheService.cached(
    cacheKey,
    async () => {
      const { data, error } = await db
        .from("test_sessions")
        .select(
          `
          *,
          test_results (*)
        `,
        )
        .eq("user_id", userId)
        .order("start_time", { ascending: false });

      if (error) throw error;

      return data.flatMap((session: any) =>
        session.test_results.map((result: any) => ({
          id: result.id,
          session: {
            ...session,
            startTime: session.start_time,
            endTime: session.end_time,
            isOffline: session.is_offline,
            config: session.config,
            questions: session.questions,
            userAnswers: session.user_answers,
          },
          score: result.score,
          totalQuestions: result.total_questions,
          correctAnswersCount: result.correct_answers_count,
        })),
      );
    },
    { ttl: 300 },
  ); // Cache for 5 minutes
}


/**
 * MOVED (monolith lane M3) from `SupabaseService.generateTestQuestions`,
 * verbatim, placeholder comment included. It sat under the CHAT INTERNALS
 * banner in the facade only by where it was pasted; the tests domain is its
 * owner and already consumed it through `deps`.
 *
 * KNOWN ISSUE (tracked, found during M3): this generates SAMPLE questions —
 * "Sample question 1?", options A–D, correct answer always "A" — for any
 * `createTest` that does not supply its own. It is the placeholder the
 * original comment admits to, not a generator, and it predates this lane.
 */
export function generateTestQuestions(config: any): any[] {
  // Simplified question generation - in a real app this would be more sophisticated
  const questions = [];
  const numQuestions = config.numQuestions || 10;

  for (let i = 0; i < numQuestions; i++) {
    questions.push({
      id: `q${i + 1}`,
      question: `Sample question ${i + 1}?`,
      options: ["A", "B", "C", "D"],
      correctAnswer: "A",
      subject: config.subject || "General",
      difficulty: config.difficulty || "medium",
    });
  }

  return questions;
}

/**
 * MOVED (monolith lane M3) from `SupabaseService.calculateTestScore`,
 * verbatim. Percentage of answers that match `correctAnswer`, positionally.
 */
export function calculateTestScore(questions: any[], answers: any[]): number {
  let correct = 0;
  questions.forEach((question, index) => {
    if (answers[index] === question.correctAnswer) {
      correct++;
    }
  });
  return (correct / questions.length) * 100;
}

export async function updateUserStats(
  db: DataClient,
  userId: string,
  score: number,
): Promise<void> {
  // Update user stats (simplified)
  const { data: user, error: userError } = await db
    .from("profiles")
    .select("stats")
    .eq("id", userId)
    .single();

  if (userError) throw userError;

  const currentStats = user?.stats || {};
  const testsTaken = (currentStats.testsTaken || 0) + 1;
  const totalScore = (currentStats.totalScore || 0) + score;
  const averageScore = totalScore / testsTaken;

  const { error } = await db
    .from("profiles")
    .update({
      stats: {
        ...currentStats,
        testsTaken,
        totalScore,
        averageScore,
      },
    })
    .eq("id", userId);

  if (error) throw error;
}
