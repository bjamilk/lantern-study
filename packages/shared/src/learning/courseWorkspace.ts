/**
 * Course workspace — Wave A of the academic replica.
 *
 * StudyFetch organises academic work around a Study Set. The Study tab opens
 * a personal set; a course is optional filing. This module is the activity
 * list, Turn-into targets, and the pure helpers both clients use to fill that
 * room.
 */
import type { FeatureKey } from '../design';
import { AI_CREDIT_COSTS, AI_FEATURE_CREDIT_COST, formatCreditCost } from '../utils/aiCredits';

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
  | 'headphones'
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
    status: 'ready',
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
    promise: 'Live transcript and notes while you record',
    icon: 'mic',
    feature: 'recording',
    status: 'ready',
  },
  {
    id: 'lesson',
    label: 'Lesson',
    promise: 'Structured tutor session with a plan you can skip or master',
    icon: 'school',
    feature: 'ai',
    status: 'ready',
  },
  {
    id: 'recap',
    label: 'Recap',
    promise: 'Generated listen-through',
    icon: 'headphones',
    feature: 'ai',
    status: 'ready',
  },
  {
    id: 'play',
    label: 'Play',
    promise: 'Match and speed games from this course’s cards',
    icon: 'game-controller',
    feature: 'flashcards',
    status: 'ready',
  },
  {
    id: 'plan',
    label: 'Plan',
    promise: 'Study calendar and syllabus outline',
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
    status: 'ready',
  },
];

export const WORKSPACE_LATER_COPY =
  'This activity ships in a later wave. Notes, walkthrough, cards, quiz, tests, lecture, lesson, recap, play, plan and essay are ready now.';

export type TurnIntoTargetId = 'cards' | 'test' | 'lesson' | 'recap' | 'essay' | 'play';

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
    promise: 'A deck filed in this set',
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
  {
    id: 'lesson',
    label: 'Lesson',
    promise: 'A guided lesson from this material',
    icon: 'school',
    feature: 'ai',
  },
  {
    id: 'recap',
    label: 'Audio recap',
    promise: 'A spoken recap you can interrupt',
    icon: 'headphones',
    feature: 'ai',
  },
  {
    id: 'essay',
    label: 'Essay',
    promise: 'A graded essay from this material',
    icon: 'document',
    feature: 'tests',
  },
  {
    id: 'play',
    label: 'Play',
    promise: 'Match and speed games from this material',
    icon: 'game-controller',
    feature: 'flashcards',
  },
];

/**
 * What each Turn-into destination costs, so a pill never promises a free
 * action that bills, or bills for one that never calls a model.
 *
 * `cards` and `test` run a generation job. `lesson`, `recap` and `essay` open
 * a studio whose first request sits behind `aiRateLimitForFeature`, which
 * charges exactly one AI use. `play` only shuffles cards you already have.
 */
export const TURN_INTO_COST: Record<TurnIntoTargetId, number> = {
  cards: AI_CREDIT_COSTS.generate_flashcards,
  test: AI_CREDIT_COSTS.generate_questions,
  lesson: AI_FEATURE_CREDIT_COST,
  recap: AI_FEATURE_CREDIT_COST,
  essay: AI_FEATURE_CREDIT_COST,
  play: 0,
};

/** One price line for both clients. Zero is said plainly, not as "0 AI uses". */
export function formatTurnIntoCost(id: TurnIntoTargetId): string {
  const cost = TURN_INTO_COST[id];
  return cost === 0 ? 'no AI use' : formatCreditCost(cost);
}

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

/** Hub and room captions: what is actually sitting in this course. */
export function formatCourseMaterialCounts(counts: {
  notes: number;
  decks: number;
  tests?: number;
}): string {
  const notes = counts.notes;
  const decks = counts.decks;
  const tests = counts.tests ?? 0;
  if (notes === 0 && decks === 0 && tests === 0) {
    return 'No materials yet — import or open to add some';
  }
  const parts = [
    `${notes} ${notes === 1 ? 'note' : 'notes'}`,
    `${decks} ${decks === 1 ? 'deck' : 'decks'}`,
  ];
  if (tests > 0) {
    parts.push(`${tests} ${tests === 1 ? 'test' : 'tests'}`);
  }
  return parts.join(' · ');
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

export type WorkspaceScope = 'set' | 'course';

/**
 * Which container the student is actually standing in.
 *
 * A study set room reuses the course room's copy, so every line that names
 * "this course" lied the moment sets became the primary container. One helper
 * so the noun is decided once and the copy sites only interpolate it.
 */
export function scopeNoun(
  studySetId?: string | null,
  _courseId?: string | null
): WorkspaceScope {
  return typeof studySetId === 'string' && studySetId.trim() ? 'set' : 'course';
}

const SCOPED_ACTIVITY_PROMISES: Partial<Record<WorkspaceActivityId, (scope: WorkspaceScope) => string>> =
  {
    notes: (scope) => `Read and edit this ${scope}’s notes`,
    cards: (scope) => `Decks filed in this ${scope}`,
    play: (scope) => `Match and speed games from this ${scope}’s cards`,
  };

/** An activity's promise, with its container named correctly. */
export function workspaceActivityPromise(
  activity: WorkspaceActivityId,
  promise: string,
  scope: WorkspaceScope
): string {
  const scoped = SCOPED_ACTIVITY_PROMISES[activity];
  return scoped ? scoped(scope) : promise;
}
