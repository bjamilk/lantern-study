/**
 * Pure helpers behind the mobile topic typeahead (TopicPicker), the sibling of
 * utils/courseSelection.ts. Kept free of React so the filter, the "Add ‘…’"
 * decision and the course-change rule can be unit-tested.
 */
import type { CourseTopic } from '@lantern/shared/types';
// The one definition of the cap lives in @lantern/shared; a second copy of
// "120" here is how a client starts silently posting titles the server rejects.
import { COURSE_TOPIC_COPY, TOPIC_TITLE_MAX } from '@lantern/shared/learning';

/** Server-side normalisation, mirrored so the "Add" row shows what will be created. */
export function normalizeTopicTitle(raw: string): string {
  return String(raw ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * "Gas exchange" — the one label every topic row and trigger uses. Falls back
 * the way web does: a blank title would otherwise render an invisible, still
 * tappable row, which reads as a broken list rather than a damaged topic.
 */
export function formatTopicLabel(topic: Pick<CourseTopic, 'title'>): string {
  return normalizeTopicTitle(topic.title) || COURSE_TOPIC_COPY.untitled;
}

/** Filter an outline by the search box, preserving syllabus order. */
export function filterTopics(topics: CourseTopic[], query: string): CourseTopic[] {
  const q = normalizeTopicTitle(query).toLowerCase();
  if (!q) return topics;
  return topics.filter(topic => topic.title.toLowerCase().includes(q));
}

/**
 * Should the list offer an "Add ‘Gas exchange’" row for this query? Only when
 * the typed title is usable and no visible topic already has it — the server's
 * unique index is case-insensitive, so "gas exchange" would find-or-create the
 * same row as "Gas Exchange" and the offer would be a lie.
 */
export function suggestTopicCreation(query: string, visible: CourseTopic[]): string | null {
  const title = normalizeTopicTitle(query);
  if (!title || title.length > TOPIC_TITLE_MAX) return null;
  const exists = visible.some(topic => topic.title.toLowerCase() === title.toLowerCase());
  return exists ? null : title;
}

/**
 * A topic may never outlive its course: `resolveForArtefact` rejects a topic
 * without a course and a topic from a different course, so changing or
 * clearing the course must clear the selection before it reaches the server.
 */
export function topicIdAfterCourseChange(
  currentTopicId: string | null | undefined,
  previousCourseId: string | null | undefined,
  nextCourseId: string | null | undefined
): string | null {
  if (!nextCourseId) return null;
  return (previousCourseId ?? null) === nextCourseId ? (currentTopicId ?? null) : null;
}
