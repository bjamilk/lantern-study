/**
 * data/academic.ts — where an artefact gets its course and topic.
 *
 * ## Purpose
 *
 * Extracted verbatim from `services/supabase.ts` (monolith lane M1, step 3).
 * Every artefact (note, deck, test session, offline bundle, listing) files
 * itself under a `course_id` and a `topic_id`, and these three functions are
 * the validation in front of that write.
 *
 * ## What it touches
 *
 * No table literal of its own: `currentArtefactCourseId` takes the table NAME
 * as an argument (one of the seven dynamic `.from(<identifier>)` sites frozen
 * by `supabase.tableInventory.test.ts` — read its banner before changing the
 * signature). The topic lookup itself belongs to `CourseTopicsService`, which
 * is injected as a `resolveForArtefact` callback rather than imported, so this
 * module stays a leaf and does not re-enter `SupabaseService`.
 *
 * ## The gotcha
 *
 * The invariant is that a topic is validated against the course the row will
 * END UP with, not the one in the request body — otherwise a course change
 * orphans the topic. That is why `resolveArtefactTopicPatch` reads the row's
 * CURRENT course first, and why `undefined` ("leave `topic_id` alone") is a
 * distinct return value from `null` ("clear it"): a write made before the
 * migration must never name the column at all.
 *
 * `currentArtefactCourseId` checks `error` even though supabase-js RESOLVES on
 * a Postgres error. Without that check a transient failure reads as "this
 * artefact has no course", which both rejects a valid topic and silently
 * CLEARS an existing one on a patch that merely re-sends the same course.
 */
import type { DataClient } from "./client";

/**
 * Validates a topic id against a course id, resolving to the id to store or
 * throwing a `PublicError`. Supplied by the caller (it is
 * `CourseTopicsService.resolveForArtefact`) so this module does not depend on
 * `SupabaseService`.
 */
export type ResolveTopicForArtefact = (
  topicId: unknown,
  courseId: unknown,
) => Promise<string | null>;

/**
 * The topic to store on an artefact, validated against the course the row
 * will END UP with — not the one in the request body. Returns undefined for
 * "leave topic_id alone", so a write before the migration never names the
 * column at all.
 */
export async function resolveArtefactTopic(
  resolveForArtefact: ResolveTopicForArtefact,
  input: {
    /** undefined = the write does not mention a topic. */
    topicId?: unknown;
    /** undefined = the write does not change the course. */
    courseId?: unknown;
    /** The row's course before this write; omit on create — nothing to orphan. */
    currentCourseId?: string | null;
  },
): Promise<string | null | undefined> {
  const { topicId, courseId, currentCourseId } = input;

  if (topicId === undefined) {
    // A patch that moves the artefact to another course (or unfiles it) must
    // take the topic with it: a topic outliving its course is exactly the
    // orphan the invariant forbids.
    const movedCourse =
      courseId !== undefined &&
      currentCourseId !== undefined &&
      String(courseId ?? "") !== String(currentCourseId ?? "");
    return movedCourse ? null : undefined;
  }
  if (topicId === null || topicId === "") return null;

  const effectiveCourseId =
    courseId !== undefined
      ? typeof courseId === "string" && courseId
        ? courseId
        : null
      : (currentCourseId ?? null);
  return resolveForArtefact(topicId, effectiveCourseId);
}

/**
 * Same, for a PATCH: reads the row's current course (the only way to know
 * what it ends up with) and only when the answer depends on it.
 */
export async function resolveArtefactTopicPatch(
  supabase: DataClient,
  resolveForArtefact: ResolveTopicForArtefact,
  table: string,
  id: string,
  updates: { topicId?: unknown; courseId?: unknown },
): Promise<string | null | undefined> {
  if (updates.topicId === undefined && updates.courseId === undefined) {
    return undefined;
  }
  return resolveArtefactTopic(resolveForArtefact, {
    topicId: updates.topicId,
    courseId: updates.courseId,
    currentCourseId: await currentArtefactCourseId(supabase, table, id),
  });
}

/** The artefact's course as stored today; null when it has none (or is gone). */
export async function currentArtefactCourseId(
  supabase: DataClient,
  table: string,
  id: string,
): Promise<string | null> {
  // supabase-js RESOLVES on a Postgres error, so an unchecked read here would
  // report "this artefact has no course" for a transient failure — which both
  // rejects a valid topic and silently CLEARS an existing one on a patch that
  // merely re-sends the same course. Fail the write instead of guessing.
  const { data, error } = await supabase
    .from(table)
    .select("course_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as { course_id?: string | null } | null)?.course_id ?? null;
}
