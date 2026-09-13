/**
 * Which outline the study calendar is allowed to plan against.
 *
 * The calendar used to ask `getCourseTopics(courseId)` and nothing else, so a
 * STUDY SET — the primary container, and the only one most students ever open —
 * arrived with an empty topic list no matter how complete its saved plan was.
 * The screen then drew `no_topics` and disabled `Generate plan`, telling the
 * student to add a syllabus to a "course" that, for a course-less set, does not
 * exist. The set's plan is the same one the room's Plan segment renders; the
 * calendar just never read it.
 *
 * The rule is the scope, not the data: a set-scoped calendar plans against the
 * SET's saved plan and never silently borrows its course's outline (they can
 * disagree, and the set's plan is the one the student ticks off), while a
 * course-scoped calendar keeps using the course outline it always did.
 *
 * Pure on purpose — no store, no fetch — so the wording and the fallback can be
 * tested without a renderer.
 */
import { scopeNoun, type WorkspaceScope } from '@lantern/shared/learning';

/** All the generator and the blocker ever read off a topic. */
export interface CalendarTopicRow {
  id: string;
  title: string;
}

function usable(
  rows: readonly { id?: string | null; title?: string | null }[] | null | undefined
): CalendarTopicRow[] {
  return (rows ?? [])
    .filter((row) => Boolean(row?.id) && Boolean(row?.title?.trim()))
    .map((row) => ({ id: String(row.id), title: String(row.title).trim() }));
}

export function calendarTopicsFor(input: {
  studySetId?: string | null;
  courseId?: string | null;
  setPlanTopics?: readonly { id?: string | null; title?: string | null }[] | null;
  courseTopics?: readonly { id?: string | null; title?: string | null }[] | null;
}): CalendarTopicRow[] {
  return scopeNoun(input.studySetId, input.courseId) === 'set'
    ? usable(input.setPlanTopics)
    : usable(input.courseTopics);
}

/** The `no_topics` line, naming the container the student is actually in. */
export function calendarNoTopicsCopy(scope: WorkspaceScope): string {
  return scope === 'set'
    ? 'Add topics so this set has a plan to study against.'
    : 'Add topics so this course has a syllabus to study against.';
}
