/**
 * Course workspace — Wave A of the academic replica.
 *
 * StudyFetch organises academic work around a Study Set. Lantern already files
 * notes, decks and tests by course, so the room is the enrolled course, not a
 * parallel object. This module is the activity list, Turn-into targets, and
 * the pure helpers both clients use to fill that room.
 */
import type { FeatureKey } from '../design';

/** AppIcon names that exist on both web and mobile maps. */
export type WorkspaceIconName =
  | 'document-text'
  | 'book'
  | 'layers'
  | 'help-circle'
  | 'clipboard'
  | 'mic'
  | 'school'
  | 'volume-medium'
  | 'game-controller'
  | 'calendar'
  | 'document'
  | 'cloud-upload'
  | 'git-branch'
  | 'sparkles'
  | 'library';

export type WorkspaceActivityId =
  | 'notes'
  | 'walkthrough'
  | 'cards'
  | 'quiz'
  | 'test'
  | 'lecture'
  | 'lesson'
  | 'recap'
  | 'play'
  | 'plan'
  | 'essay';

export type WorkspaceActivityStatus = 'ready' | 'later';

export interface WorkspaceActivity {
  id: WorkspaceActivityId;
  label: string;
  promise: string;
  icon: WorkspaceIconName;
  feature: FeatureKey;
  status: WorkspaceActivityStatus;
}

/**
 * The activity row in the course room. `ready` lands on something we already
 * ship. `later` is visible so the graph is complete, and the clients refuse
 * the tap with a later-wave line rather than a missing screen.
 */
export const WORKSPACE_ACTIVITIES: readonly WorkspaceActivity[] = [
  {
    id: 'notes',
    label: 'Notes',
    promise: 'Read and edit this course’s notes',
    icon: 'document-text',
    feature: 'notes',
    status: 'ready',
  },
  {
    id: 'walkthrough',
    label: 'Walkthrough',
    promise: 'One page at a time',
    icon: 'book',
    feature: 'notes',
    status: 'ready',
  },
  {
    id: 'cards',
    label: 'Cards',
    promise: 'Decks filed in this course',
    icon: 'layers',
    feature: 'flashcards',
    status: 'ready',
  },
  {
    id: 'quiz',
    label: 'Quiz',
    promise: 'Adaptive quiz with confidence ratings',
    icon: 'help-circle',
    feature: 'tests',
    status: 'later',
  },
  {
    id: 'test',
    label: 'Test',
    promise: 'Practice under exam conditions',
    icon: 'clipboard',
    feature: 'tests',
    status: 'ready',
  },
  {
    id: 'lecture',
    label: 'Lecture',
    promise: 'Record into a note in this course',
    icon: 'mic',
    feature: 'recording',
    status: 'ready',
  },
  {
    id: 'lesson',
    label: 'Lesson',
    promise: 'Structured tutor session',
    icon: 'school',
    feature: 'ai',
    status: 'later',
  },
  {
    id: 'recap',
    label: 'Recap',
    promise: 'Generated listen-through',
    icon: 'volume-medium',
    feature: 'ai',
    status: 'later',
  },
  {
    id: 'play',
    label: 'Play',
    promise: 'Match game from this course’s cards',
    icon: 'game-controller',
    feature: 'flashcards',
    status: 'ready',
  },
  {
    id: 'plan',
    label: 'Plan',
    promise: 'Syllabus outline for this course',
    icon: 'calendar',
    feature: 'tests',
    status: 'ready',
  },
  {
    id: 'essay',
    label: 'Essay',
    promise: 'Rubric feedback on a draft',
    icon: 'document',
    feature: 'tests',
    status: 'later',
  },
];

export const WORKSPACE_LATER_COPY =
  'This activity ships in a later wave. Notes, cards, tests, lecture and play are ready now.';

export type TurnIntoTargetId = 'cards' | 'test';

export interface TurnIntoTarget {
  id: TurnIntoTargetId;
  label: string;
  promise: string;
  icon: WorkspaceIconName;
  feature: FeatureKey;
}

export const TURN_INTO_TARGETS: readonly TurnIntoTarget[] = [
  {
    id: 'cards',
    label: 'Flashcards',
    promise: 'A deck filed in this course',
    icon: 'layers',
    feature: 'flashcards',
  },
  {
    id: 'test',
    label: 'Practice test',
    promise: 'A saved test you can sit again',
    icon: 'clipboard',
    feature: 'tests',
  },
];

export interface WorkspaceRecent {
  courseId: string;
  openedAt: number;
}

export const WORKSPACE_RECENTS_STORAGE_KEY = 'lantern.study.workspaceRecents';

export const WORKSPACE_RECENTS_MAX = 8;

export function upsertWorkspaceRecent(
  list: readonly WorkspaceRecent[],
  courseId: string,
  openedAt: number = Date.now(),
  max: number = WORKSPACE_RECENTS_MAX
): WorkspaceRecent[] {
  const id = courseId.trim();
  if (!id) return [...list];
  const next = [{ courseId: id, openedAt }, ...list.filter((row) => row.courseId !== id)];
  return next.slice(0, max);
}

export function filedCourseId(item: {
  courseId?: string | null;
  course_id?: string | null;
}): string | null {
  return item.courseId ?? item.course_id ?? null;
}

export function materialsForCourse<T extends { courseId?: string | null; course_id?: string | null }>(
  items: readonly T[],
  courseId: string
): T[] {
  return items.filter((item) => filedCourseId(item) === courseId);
}

/** Personal tests filed on the course, or minted from one of its notes/decks. */
export function testsFiledInCourse<T extends {
  courseId?: string | null;
  sourceNoteId?: string | null;
  sourceDeckId?: string | null;
  deckId?: string | null;
}>(
  tests: readonly T[],
  courseId: string,
  noteIds: ReadonlySet<string>,
  deckIds: ReadonlySet<string>
): T[] {
  return tests.filter((test) => {
    if (test.courseId === courseId) return true;
    if (test.sourceNoteId && noteIds.has(test.sourceNoteId)) return true;
    if (test.sourceDeckId && deckIds.has(test.sourceDeckId)) return true;
    if (test.deckId && deckIds.has(test.deckId)) return true;
    return false;
  });
}

/** Lecture notes are named by the Record door, or they are audio-sourced. */
export function isLectureNote(note: { title?: string | null; sourceType?: string | null }): boolean {
  if (note.sourceType === 'audio') return true;
  return /^Lecture — /.test(note.title ?? '');
}

export function courseWorkspaceLabel(course: {
  code?: string | null;
  title?: string | null;
  name?: string | null;
}): string {
  const code = course.code?.trim();
  const title = (course.title ?? course.name)?.trim();
  if (code && title && title !== code) return `${code} · ${title}`;
  return code || title || 'Course';
}

const WALKABLE_TYPES = new Set(['pdf', 'presentation']);

export function isWalkableAttachment(attachment: {
  id?: string | null;
  type?: string | null;
}): boolean {
  return Boolean(attachment.id && WALKABLE_TYPES.has(String(attachment.type)));
}
