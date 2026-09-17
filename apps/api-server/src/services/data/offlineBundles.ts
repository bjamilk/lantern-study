/**
 * data/offlineBundles.ts — `offline_bundles`, the deck ACCESS gate, and the
 * flashcard reads/writes and per-question stats that hang off it.
 *
 * ## Purpose
 *
 * Extracted verbatim from `services/supabase.ts` (monolith lane M1c, step 9):
 * the whole OFFLINE BUNDLES banner section, 21 methods.
 *
 * ## The banner lies, and that is deliberate
 *
 * Only the first three methods are actually about offline bundles. The other
 * eighteen are the deck access gate (`fetchDeckRecord`, `verifyDeckAccess`,
 * `getDeckForUser`, `getAccessibleDeckIds`), the flashcard row layer
 * (`getFlashcard*`, `reviewFlashcard`, `updateFlashcard`, `deleteFlashcard`,
 * comments) and the per-question statistics — all of which drifted under this
 * banner and were left there by the DECKS AND FLASHCARDS extraction
 * (`data/decks.ts`, lane M1b step 7), whose banner already records that the
 * gate "sits inside the OFFLINE BUNDLES banner below, misfiled, and moves with
 * that section". This module IS that section, moved as one unit so the plan's
 * step boundary stays honest. Renaming the section, or splitting the gate and
 * the cards into their own modules, is a later step's job and a behaviour-
 * neutral rename this lane deliberately does not take on.
 *
 * ## What it touches
 *
 * Tables: `offline_bundles`, `decks`, `deck_collaborators`, `flashcards`,
 * `flashcard_comments`, `user_question_stats`, `messages` (the question-stem
 * join in `attachQuestionStatStems`). One RPC, `record_deck_study`. No storage
 * buckets.
 *
 * ## The gotchas
 *
 * 1. THIS IS THE ACCESS GATE FOR THE WHOLE FLASHCARDS FEATURE. The service
 *    role bypasses RLS, so `verifyDeckAccess` is the only thing standing
 *    between a caller and someone else's deck. `data/decks.ts`,
 *    `data/storageAcl.ts` and `data/uploads.ts` all inject it; widening it
 *    widens deck, flashcard and cover-image access at once.
 *
 * 2. `fetchDeckRecord` projects `cover_path` only while the column exists —
 *    naming a column the (hand-applied) migration has not added yet 42703s
 *    EVERY deck read, and deck reads gate the access checks, so that would
 *    take the whole feature down. The ladder is load-bearing, not dead code.
 *
 * 3. Reviews are compare-and-swap on `flashcards.version`: a losing write
 *    raises `VersionConflictError` rather than silently overwriting. Anything
 *    that bulk-updates cards (`resetDeckStatistics`) must therefore purge the
 *    per-card caches, or the next review validates against a stale version and
 *    is dropped.
 *
 * 4. `reviewFlashcard` is the hottest path in the app — it fires on every
 *    graded card. Its three side effects (learning event, mastery refresh,
 *    `record_deck_study` + learning connection) are all best-effort and must
 *    never fail a review; the deck-study call is additionally rate-limited by
 *    a cache key that is stamped only AFTER the work resolves.
 *
 * ## Why almost everything here takes `deps`
 *
 * Several of these methods call each other (`updateFlashcard` →
 * `getFlashcardForUser` → `verifyDeckAccess`, `reviewFlashcard` → all three).
 * They are NOT wired up as local function calls even though the callee now
 * lives in this same file: `supabase.resetDeck.test.ts`,
 * `learningEvents.test.ts` and `supabase.deckWithCards.test.ts` all stub those
 * methods on a `SupabaseService` stand-in and drive the entry point through
 * `SupabaseService.prototype.<m>.call(self, …)`. A sibling call would step
 * around the stub and the test would exercise code it believes it replaced.
 * So every cross-method call goes back out through `deps`, which the facade
 * builds INLINE at each call site as arrows over `this`.
 *
 * MONOLITH LANE M3: the four collaborators below arrive as narrow arrows
 * (`lookupDeckOwnerAndCourse`, `recordLearningEvent`, `refreshTopicMastery`,
 * `recordLearningConnection`) instead of the whole facade, so this module no
 * longer names `SupabaseService`. Their lazy `await import(...)` moved into
 * the arrows `data/index.ts` builds; the import still happens on CALL.
 *
 * They are the Phase 1/3 collaborators — `learningEvents`, `topicMastery`,
 * `learningConnections` — and each is stubbed by name in the suites above, so
 * a narrower dep is also a smaller thing for a harness to fake.
 */
import { logger } from "../../utils/logger";
import { buildFlashcardUpdateData } from "../../utils/flashcardUpdate";
import { VersionConflictError } from "../../utils/versionConflict";
import { calculateFsrsData } from "@lantern/shared/utils/fsrs";
import {
  getSrsMaxInterval,
  normalizeUserSettings,
} from "@lantern/shared/settings";
import { normalizeCoverRef } from "@lantern/shared/utils/storageUrl";
import type {
  LearningEventInput,
  LearningSurface,
} from "@lantern/shared/learning";

import { applyCourseFilter, type CourseFilter } from "../academicCourses";
import { cacheService } from "../cache";
import { buildCardReviewedEvent } from "../learningEvents";
import type { ConnectionInput as LearningConnectionInput } from "../learningConnections";

import { resolveCourseIdFromConfigLike } from "./academic";
import type { DataClient } from "./client";
import { isMissingCoverPathColumn } from "./coverImages";

/**
 * Moved with the section: `getFlashcards` was the only reader of either. They
 * were `private static readonly` on `SupabaseService`, so nothing outside
 * could see them (`routes/flashcards.ts` has its own, separate pair with
 * different values — that is pre-existing and unchanged).
 */
const DEFAULT_FLASHCARD_PAGE_SIZE = 50;
const MAX_FLASHCARD_PAGE_SIZE = 100;

/**
 * Everything a moved body used to reach through `this`.
 *
 * Build this literal INLINE at each delegating call site, with arrows that
 * read `this.<method>` at CALL time. Hoisting it to an instance field compiles
 * and passes the surface freeze, but breaks every suite that invokes these
 * methods on a bare `{ supabase }` stand-in that never ran a constructor, and
 * bypasses every `jest.spyOn` on a gate method.
 */
export type FlashcardDeps = {
  /** The four collaborators that take the whole facade; see the banner. */
  lookupDeckOwnerAndCourse: (
    deckId: unknown,
  ) => Promise<{ ownerId: string | null; courseId: string | null }>;
  recordLearningEvent: (input: LearningEventInput) => Promise<number>;
  refreshTopicMastery: (userId: string) => Promise<void>;
  recordLearningConnection: (input: LearningConnectionInput) => Promise<void>;
  fetchDeckRecord: (deckId: string) => Promise<any | null>;
  verifyDeckAccess: (
    userId: string,
    deckId: string,
    level?: "read" | "edit" | "owner",
  ) => Promise<boolean>;
  getAccessibleDeckIds: (userId: string) => Promise<string[]>;
  getFlashcard: (flashcardId: string) => Promise<any | null>;
  getFlashcardForUser: (
    flashcardId: string,
    userId: string,
  ) => Promise<any | null>;
  updateFlashcard: (
    flashcardId: string,
    updates: Record<string, unknown>,
    userId?: string,
    options?: { expectedVersion?: number },
  ) => Promise<any | null>;
  attachQuestionStatStems: (rows: any[]) => Promise<any[]>;
  getUserPreferences: (userId: string) => Promise<any | null>;
  getResponseProfile: (profile?: string) => "compact" | "full";
};

export async function getOfflineBundles(
  supabase: DataClient,
  userId: string,
  options: {
    /** Academic archive filter (offline_bundles.course_id): unfiled → IS NULL, course → eq. */
    courseFilter?: CourseFilter;
  } = {},
): Promise<any[]> {
  let query = supabase
    .from("offline_bundles")
    .select("*")
    .eq("user_id", userId)
    .order("downloaded_at", { ascending: false });
  query = applyCourseFilter(query, "course_id", options.courseFilter);

  const { data, error } = await query;

  if (error) {
    logger.error("Error fetching offline bundles:", { error, userId });
    throw error;
  }

  return data || [];
}

export async function saveOfflineBundle(
  supabase: DataClient,
  userId: string,
  bundle: any,
): Promise<void> {
  // Course lives in BOTH the column (filterable) and config.courseId (the
  // shape the offline runtime already round-trips).
  const courseId = resolveCourseIdFromConfigLike(bundle);
  const config = { ...(bundle.config || {}) };
  if (courseId) config.courseId = courseId;
  else if (bundle.courseId === null) delete config.courseId;
  const insert = {
    user_id: userId,
    bundle_id: bundle.bundleId,
    config,
    course_id: courseId,
    questions: bundle.questions || [],
    group_name: bundle.groupName || null,
    display_name: bundle.displayName ?? null,
    downloaded_at: bundle.downloadedAt || new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("offline_bundles")
    .upsert(insert, { onConflict: "user_id,bundle_id" });

  if (error) {
    logger.error("Error saving offline bundle:", {
      error,
      userId,
      bundleId: bundle.bundleId,
    });
    throw error;
  }

  return;
}

export async function deleteOfflineBundle(
  supabase: DataClient,
  userId: string,
  bundleId: string,
): Promise<void> {
  const { error } = await supabase
    .from("offline_bundles")
    .delete()
    .eq("user_id", userId)
    .eq("bundle_id", bundleId);

  if (error) {
    logger.error("Error deleting offline bundle:", {
      error,
      userId,
      bundleId,
    });
    throw error;
  }

  return;
}

export async function getAccessibleDeckIds(
  supabase: DataClient,
  userId: string,
): Promise<string[]> {
  const [
    { data: ownedDecks, error: ownedError },
    { data: collaboratorRows, error: collabError },
  ] = await Promise.all([
    supabase.from("decks").select("id").eq("user_id", userId),
    supabase
      .from("deck_collaborators")
      .select("deck_id")
      .eq("user_id", userId),
  ]);

  if (ownedError) throw ownedError;
  if (collabError) throw collabError;

  const ids = new Set<string>();
  for (const deck of ownedDecks || []) ids.add(deck.id);
  for (const row of collaboratorRows || []) {
    if (row.deck_id) ids.add(row.deck_id);
  }
  return Array.from(ids);
}

/** Internal fetch — no access check. */
export async function fetchDeckRecord(
  supabase: DataClient,
  deckId: string,
): Promise<any | null> {
  // study_set_id: this record is what a deck read is answered from, and a
  // projection that omits the column reports every deck as unfiled.
  const BASE =
    "id, name, description, user_id, is_shared, course_id, study_set_id, created_at";
  const run = (withCover: boolean) =>
    supabase
      .from("decks")
      .select(withCover ? `${BASE}, cover_path` : BASE)
      .eq("id", deckId)
      .maybeSingle();

  // cover_path is projected only while it exists — naming a column the
  // migration has not added yet 42703s EVERY deck read, and deck reads gate
  // access checks, so that would take the whole flashcards feature down.
  let { data, error }: { data: any; error: any } = await run(true);
  if (error && isMissingCoverPathColumn(error)) {
    ({ data, error } = await run(false));
  }

  if (error) throw error;
  if (!data) return null;
  return {
    ...data,
    coverPath: normalizeCoverRef((data as any).cover_path ?? null),
  };
}

export async function verifyDeckAccess(
  supabase: DataClient,
  deps: FlashcardDeps,
  userId: string,
  deckId: string,
  level: "read" | "edit" | "owner" = "read",
): Promise<boolean> {
  const deck = await deps.fetchDeckRecord(deckId);
  if (!deck) return false;

  const isOwner = deck.user_id === userId;
  if (level === "owner") return isOwner;
  if (isOwner) return true;

  const { data: collab, error: collabError } = await supabase
    .from("deck_collaborators")
    .select("role")
    .eq("deck_id", deckId)
    .eq("user_id", userId)
    .maybeSingle();

  if (collabError) throw collabError;

  if (collab) {
    if (level === "read") return true;
    if (level === "edit")
      return collab.role === "editor" || collab.role === "owner";
  }

  if (level === "read" && deck.is_shared) return true;
  return false;
}

export async function getDeckForUser(
  supabase: DataClient,
  deps: FlashcardDeps,
  deckId: string,
  userId: string,
): Promise<any | null> {
  const cacheKey = `deck:${deckId}:user:${userId}`;
  const cached = await cacheService.get(cacheKey);
  if (cached !== null) return cached;

  const hasAccess = await deps.verifyDeckAccess(userId, deckId, "read");
  if (!hasAccess) return null;

  const deck = await deps.fetchDeckRecord(deckId);
  if (deck) await cacheService.set(cacheKey, deck, 1800);
  return deck;
}

export async function getFlashcardForUser(
  supabase: DataClient,
  deps: FlashcardDeps,
  flashcardId: string,
  userId: string,
): Promise<any | null> {
  const cacheKey = `flashcard:${flashcardId}:user:${userId}`;
  const cached = await cacheService.get<any>(cacheKey);
  if (cached !== null) return cached;

  const { data, error } = await supabase
    .from("flashcards")
    .select("*")
    .eq("id", flashcardId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const hasAccess = await deps.verifyDeckAccess(userId, data.deck_id, "read");
  if (!hasAccess) return null;

  await cacheService.set(cacheKey, data, 1800);
  return data;
}

export async function getFlashcards(
  supabase: DataClient,
  deps: FlashcardDeps,
  userId: string,
  deckId?: string,
  options?: {
    page?: number;
    limit?: number;
    responseProfile?: "compact" | "full";
  },
): Promise<any[]> {
  const {
    page = 1,
    limit = DEFAULT_FLASHCARD_PAGE_SIZE,
    responseProfile = "full",
  } = options || {};
  const profile = deps.getResponseProfile(responseProfile);
  const safeLimit = Math.min(
    MAX_FLASHCARD_PAGE_SIZE,
    Math.max(1, limit),
  );
  const safePage = Math.max(1, page);
  const offset = (safePage - 1) * safeLimit;

  const selectClause =
    profile === "compact"
      ? "id, deck_id, type, front, image_url, tags, created_at, version, updated_at"
      : "id, deck_id, type, front, back, cloze_text, image_url, occlusion_data, srs_data, tags, created_at, version, updated_at";

  const accessibleDeckIds = await deps.getAccessibleDeckIds(userId);

  if (accessibleDeckIds.length === 0) {
    return [];
  }

  let query = supabase
    .from("flashcards")
    .select(selectClause)
    .in("deck_id", accessibleDeckIds)
    .order("created_at", { ascending: false });

  if (deckId) {
    if (!accessibleDeckIds.includes(deckId)) {
      return [];
    }
    query = query.eq("deck_id", deckId);
  }

  const { data, error } = await query.range(offset, offset + safeLimit - 1);

  if (error) throw error;

  return data || [];
}

export async function getFlashcard(
  supabase: DataClient,
  flashcardId: string,
): Promise<any | null> {
  const cacheKey = `flashcard:${flashcardId}`;
  const cached = await cacheService.get<any>(cacheKey);
  if (cached !== null) return cached;

  const { data, error } = await supabase
    .from("flashcards")
    .select("*")
    .eq("id", flashcardId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }

  await cacheService.set(cacheKey, data, 1800); // 30 minutes
  return data;
}

export async function getFlashcardComments(
  supabase: DataClient,
  flashcardId: string,
): Promise<any[]> {
  const cacheKey = `flashcard_comments:${flashcardId}`;
  const cached = await cacheService.get<any[]>(cacheKey);
  if (cached !== null) return cached;

  const { data, error } = await supabase
    .from("flashcard_comments")
    .select("*")
    .eq("flashcard_id", flashcardId)
    .order("created_at", { ascending: true });

  if (error) throw error;

  await cacheService.set(cacheKey, data, 300);
  return data;
}

export async function addFlashcardComment(
  supabase: DataClient,
  flashcardId: string,
  userId: string,
  comment: string,
): Promise<any> {
  const { data, error } = await supabase
    .from("flashcard_comments")
    .insert({ flashcard_id: flashcardId, user_id: userId, comment })
    .select()
    .single();

  if (error) throw error;

  await cacheService.delete(`flashcard_comments:${flashcardId}`);
  return data;
}

export async function reviewFlashcard(
  supabase: DataClient,
  deps: FlashcardDeps,
  flashcardId: string,
  userId: string,
  rating: "again" | "hard" | "good" | "easy",
  options: {
    expectedVersion?: number;
    /** 'web' | 'mobile' from x-lantern-surface; default 'api'. */
    surface?: LearningSurface;
    /** Offline replay: when the grade was actually given (ISO). */
    occurredAt?: string | null;
  } = {},
): Promise<any | null> {
  const existing = await deps.getFlashcardForUser(flashcardId, userId);
  if (!existing) return null;

  const canEdit = await deps.verifyDeckAccess(
    userId,
    existing.deck_id,
    "edit",
  );
  if (!canEdit) return null;

  const prefs = await deps.getUserPreferences(userId);
  const settings = normalizeUserSettings(
    prefs?.preferences ?? prefs?.settings ?? {},
  );
  const newSrsData = calculateFsrsData(existing.srs_data, rating, {
    maxInterval: getSrsMaxInterval(settings.study),
  });

  const expectedVersion =
    options.expectedVersion != null &&
    Number.isFinite(Number(options.expectedVersion))
      ? Number(options.expectedVersion)
      : Number(existing.version) || 1;
  const updated = await deps.updateFlashcard(
    flashcardId,
    { srsData: newSrsData },
    userId,
    { expectedVersion },
  );

  // learning_events: card_reviewed with the FSRS state before/after. Only
  // after the CAS write landed (a 409 throws above and emits nothing).
  // recordLearningEvent never throws — the review never fails on telemetry.
  if (updated) {
    // One round trip for BOTH the course id (telemetry, as before) and the
    // deck owner (needed by the two Phase 3 writes below) — same query count
    // this path had previously.
    const deckMeta = await deps.lookupDeckOwnerAndCourse(existing.deck_id);

    await deps.recordLearningEvent(
      buildCardReviewedEvent({
        userId,
        flashcardId,
        deckId: existing.deck_id,
        courseId: deckMeta.courseId,
        rating,
        srsBefore: existing.srs_data ?? null,
        srsAfter: updated.srs_data ?? newSrsData,
        surface: options.surface ?? "api",
        occurredAt: options.occurredAt ?? null,
      }),
    );

    // Keep the mastery graph's card-side numbers (due counts, maturity)
    // moving with reviews, not only test submissions. The service debounces
    // (30s), so a 60-card session costs a couple of refreshes, and
    // refresh() never throws — a stale graph must not fail a review.
    try {
      await deps.refreshTopicMastery(userId);
    } catch {
      /* mastery refresh is best-effort */
    }

    // Phase 3 M + O — "this person studied this deck", at most once per
    // window per (deck, user).
    //
    // This is the hottest path in the app: it fires on EVERY graded card, so
    // a realistic session is 20-100 calls of which exactly one is useful.
    // record_deck_study is idempotent (it counts distinct people, not
    // sessions), so an unguarded call would be correct but would burn a
    // round trip per card. The cache key is set only AFTER the work resolves,
    // so a transient failure retries on the next card instead of being
    // suppressed for the whole window.
    if (deckMeta.ownerId && deckMeta.ownerId !== userId) {
      const studyKey = `deck_study:${existing.deck_id}:${userId}`;
      void (async () => {
        try {
          if (await cacheService.get(studyKey)) return;
          // supabase-js RESOLVES on a PostgREST/Postgres error rather than
          // rejecting, so the result must be inspected. Without this the
          // catch below never fires, the key is stamped anyway, and the
          // "transient failures self-heal on the next card" promise in the
          // comment above is silently false for a full 6 hours.
          const { error: studyError } = await supabase.rpc("record_deck_study", {
            p_deck_id: existing.deck_id,
            p_user_id: userId,
          });
          if (studyError) throw studyError;
          await deps.recordLearningConnection({
            // The deck's OWNER is the actor — their deck taught someone.
            // `userId` here is the STUDIER and is the beneficiary; passing it
            // as actorId would invert the metric.
            actorId: deckMeta.ownerId as string,
            beneficiaryId: userId,
            kind: "deck_collaborated",
            objectType: "deck",
            objectId: existing.deck_id,
            courseId: deckMeta.courseId,
          });
          await cacheService.set(studyKey, 1, 6 * 60 * 60);
        } catch {
          /* best-effort: a counter must never fail a review */
        }
      })();
    }
  }
  return updated;
}

export async function updateFlashcard(
  supabase: DataClient,
  deps: FlashcardDeps,
  flashcardId: string,
  updates: {
    front?: string;
    back?: string;
    clozeText?: string;
    imageUrl?: string;
    occlusionData?: any;
    srsData?: any;
    tags?: string[];
  },
  userId?: string,
  options: { expectedVersion?: number } = {},
): Promise<any | null> {
  const existing = userId
    ? await deps.getFlashcardForUser(flashcardId, userId)
    : await deps.getFlashcard(flashcardId);
  if (!existing) return null;
  if (userId) {
    const canEdit = await deps.verifyDeckAccess(
      userId,
      existing.deck_id,
      "edit",
    );
    if (!canEdit) return null;
  }

  // Build update object with only defined fields.
  // CLOZE rows require front/back NULL (check_flashcard_fields); clients often
  // send front:'' which must not be written as an empty string.
  const updateData: any = buildFlashcardUpdateData(existing.type, updates);

  // If no fields to update, just return the current flashcard
  if (Object.keys(updateData).length === 0) {
    return existing;
  }

  const expectedVersion =
    options.expectedVersion != null
      ? Number(options.expectedVersion)
      : Number(existing.version) || 1;

  const { data, error } = await supabase
    .from("flashcards")
    .update(updateData)
    .eq("id", flashcardId)
    .eq("version", expectedVersion)
    .select()
    .maybeSingle();

  if (error) {
    if (error.code === "PGRST116") return null;
    logger.error("Error updating flashcard:", {
      error,
      flashcardId,
      updates,
    });
    throw new Error(error.message || "Failed to update flashcard");
  }

  if (!data) {
    const current = userId
      ? await deps.getFlashcardForUser(flashcardId, userId)
      : await deps.getFlashcard(flashcardId);
    throw new VersionConflictError(
      "Flashcard was updated by another request. Retry the review.",
      current,
    );
  }

  // Update cache and invalidate deck cache
  await cacheService.set(`flashcard:${flashcardId}`, data, 1800);
  if (userId)
    await cacheService.delete(`flashcard:${flashcardId}:user:${userId}`);
  await cacheService.deletePattern(`flashcards:*`);

  return data;
}

export async function deleteFlashcard(
  supabase: DataClient,
  deps: FlashcardDeps,
  flashcardId: string,
  userId?: string,
): Promise<boolean> {
  const flashcard = userId
    ? await deps.getFlashcardForUser(flashcardId, userId)
    : await deps.getFlashcard(flashcardId);
  if (!flashcard) return false;
  if (userId) {
    const canEdit = await deps.verifyDeckAccess(
      userId,
      flashcard.deck_id,
      "edit",
    );
    if (!canEdit) return false;
  }

  const { error } = await supabase
    .from("flashcards")
    .delete()
    .eq("id", flashcardId);

  if (error) throw error;

  // Clear caches
  await cacheService.delete(`flashcard:${flashcardId}`);
  await cacheService.deletePattern(`flashcards:*`);

  return true;
}

/**
 * Attach question stems / group names from chat messages so dashboards can
 * render "Questions to review" even when lean test history omits questions.
 */
export async function attachQuestionStatStems(
  supabase: DataClient,
  rows: any[],
): Promise<any[]> {
  if (!rows.length) return rows;
  const questionIds = [
    ...new Set(
      rows
        .map((row) => row?.question_id || row?.questionId)
        .filter((id): id is string => typeof id === "string" && !!id),
    ),
  ];
  if (!questionIds.length) return rows;

  const { data: messages, error } = await supabase
    .from("messages")
    .select("id, group_id, text, question_data, groups:group_id(name)")
    .in("id", questionIds);

  if (error) {
    logger.warn("Failed to attach question stems for user stats", { error });
    return rows;
  }

  const byId = new Map<string, any>();
  (messages || []).forEach((msg: any) => {
    if (msg?.id) byId.set(msg.id, msg);
  });

  return rows.map((row) => {
    const questionId = row?.question_id || row?.questionId;
    const msg = questionId ? byId.get(questionId) : null;
    if (!msg) return row;
    const qd =
      msg.question_data && typeof msg.question_data === "object"
        ? msg.question_data
        : {};
    const stem =
      (typeof qd.questionStem === "string" && qd.questionStem) ||
      (typeof qd.question === "string" && qd.question) ||
      (typeof qd.text === "string" && qd.text) ||
      (typeof msg.text === "string" && msg.text) ||
      null;
    const groupProfile = Array.isArray(msg.groups)
      ? msg.groups[0]
      : msg.groups;
    const groupName =
      (typeof groupProfile?.name === "string" && groupProfile.name) || null;
    return {
      ...row,
      question_stem: stem,
      group_id: msg.group_id || row.group_id || null,
      group_name: groupName,
    };
  });
}

export async function getUserQuestionStats(
  supabase: DataClient,
  deps: FlashcardDeps,
  userId: string,
): Promise<any[]> {
  const cacheKey = `user-stats:${userId}`;
  const cached = await cacheService.get<any[]>(cacheKey);
  let rows: any[];
  if (cached !== null && cached !== undefined) {
    rows = Array.isArray(cached) ? cached : [];
  } else {
    const { data, error } = await supabase
      .from("user_question_stats")
      .select("*")
      .eq("user_id", userId)
      .order("last_attempted", { ascending: false });

    if (error) throw error;

    rows = Array.isArray(data) ? data : [];
    await cacheService.set(cacheKey, rows, 1800); // 30 minutes
  }

  return deps.attachQuestionStatStems(rows);
}

export async function updateUserQuestionStats(
  supabase: DataClient,
  userId: string,
  questionId: string,
  stats: {
    correct_attempts?: number;
    incorrect_attempts?: number;
    last_attempted?: Date;
  },
): Promise<any> {
  // Check if stats exist
  const { data: existing, error: checkError } = await supabase
    .from("user_question_stats")
    .select("*")
    .eq("user_id", userId)
    .eq("question_id", questionId)
    .single();

  if (checkError && checkError.code !== "PGRST116") throw checkError;

  let result;
  if (existing) {
    // Update existing stats
    const { data, error } = await supabase
      .from("user_question_stats")
      .update({
        correct_attempts:
          stats.correct_attempts !== undefined
            ? stats.correct_attempts
            : existing.correct_attempts,
        incorrect_attempts:
          stats.incorrect_attempts !== undefined
            ? stats.incorrect_attempts
            : existing.incorrect_attempts,
        last_attempted: stats.last_attempted || existing.last_attempted,
      })
      .eq("user_id", userId)
      .eq("question_id", questionId)
      .select()
      .single();

    if (error) throw error;
    result = data;
  } else {
    // Create new stats
    const { data, error } = await supabase
      .from("user_question_stats")
      .insert({
        user_id: userId,
        question_id: questionId,
        correct_attempts: stats.correct_attempts || 0,
        incorrect_attempts: stats.incorrect_attempts || 0,
        last_attempted: stats.last_attempted || new Date(),
      })
      .select()
      .single();

    if (error) throw error;
    result = data;
  }

  // Invalidate both cache key shapes used by summary + dedicated routes.
  await cacheService.delete(`user-stats:${userId}`);
  await cacheService.delete(`user:question-stats:${userId}`);

  return result;
}

export async function getUserQuestionStat(
  supabase: DataClient,
  userId: string,
  questionId: string,
): Promise<any | null> {
  const cacheKey = `user-stat:${userId}:${questionId}`;
  const cached = await cacheService.get(cacheKey);
  if (cached !== null) return cached as any;

  const { data, error } = await supabase
    .from("user_question_stats")
    .select("*")
    .eq("user_id", userId)
    .eq("question_id", questionId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }

  await cacheService.set(cacheKey, data, 1800); // 30 minutes
  return data;
}

export async function upsertUserQuestionStat(
  supabase: DataClient,
  userId: string,
  questionId: string,
  stats: {
    correctAttempts?: number;
    incorrectAttempts?: number;
    lastAttempted?: Date;
  },
): Promise<any> {
  // Check if stats exist
  const { data: existing, error: checkError } = await supabase
    .from("user_question_stats")
    .select("*")
    .eq("user_id", userId)
    .eq("question_id", questionId)
    .single();

  if (checkError && checkError.code !== "PGRST116") throw checkError;

  let result;
  if (existing) {
    // Update existing stats
    const { data, error } = await supabase
      .from("user_question_stats")
      .update({
        correct_attempts:
          stats.correctAttempts !== undefined
            ? stats.correctAttempts
            : existing.correct_attempts,
        incorrect_attempts:
          stats.incorrectAttempts !== undefined
            ? stats.incorrectAttempts
            : existing.incorrect_attempts,
        last_attempted: stats.lastAttempted || existing.last_attempted,
      })
      .eq("user_id", userId)
      .eq("question_id", questionId)
      .select()
      .single();

    if (error) throw error;
    result = data;
  } else {
    // Create new stats
    const { data, error } = await supabase
      .from("user_question_stats")
      .insert({
        user_id: userId,
        question_id: questionId,
        correct_attempts: stats.correctAttempts || 0,
        incorrect_attempts: stats.incorrectAttempts || 0,
        last_attempted: stats.lastAttempted || new Date(),
      })
      .select()
      .single();

    if (error) throw error;
    result = data;
  }

  // Invalidate both cache key shapes used by summary + dedicated routes.
  await cacheService.delete(`user-stats:${userId}`);
  await cacheService.delete(`user:question-stats:${userId}`);

  return result;
}

export async function resetDeckStatistics(
  supabase: DataClient,
  deps: FlashcardDeps,
  deckId: string,
  userId: string,
): Promise<any> {
  const canEdit = await deps.verifyDeckAccess(userId, deckId, "edit");
  if (!canEdit) throw new Error("Deck not found or access denied");

  // clear srs_data on all cards in deck so they appear new again
  const { error: cardError } = await supabase
    .from("flashcards")
    .update({ srs_data: {} })
    .eq("deck_id", deckId);

  if (cardError) throw cardError;

  // Reviews read the card (and its version) through the per-card caches
  // (`flashcard:{id}` and `flashcard:{id}:user:{userId}`). The bulk update
  // above just changed every card underneath those entries, so a review
  // graded after a reset would validate against a stale version and be
  // dropped. Purge each card's cache entries so the next read is fresh.
  const { data: deckCards, error: deckCardsError } = await supabase
    .from("flashcards")
    .select("id")
    .eq("deck_id", deckId);
  if (deckCardsError) throw deckCardsError;
  await Promise.all(
    ((deckCards || []) as Array<{ id: string }>).flatMap((card) => [
      cacheService.delete(`flashcard:${card.id}`),
      cacheService.deletePattern(`flashcard:${card.id}:user:*`),
    ]),
  );

  // also invalidate any related cache entries
  await cacheService.deletePattern(`flashcards:*`);
  await cacheService.delete(`deck:${deckId}`);

  return { success: true };
}
