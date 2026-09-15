/**
 * Course workspace — Wave A of the academic replica.
 *
 * StudyFetch organises academic work around a Study Set. The Study tab opens
 * a personal set; a course is optional filing. This module is the activity
 * list, Turn-into targets, and the pure helpers both clients use to fill that
 * room.

 *
 * CONSUMERS: web + mobile (the set room and course workspace screens). Not the api.
 *
 * GOTCHAS: `packages/shared` is consumed BUILT — run `npm run build` in
 * packages/shared before typechecking or running web/mobile, or consumers
 * resolve a stale `dist/`. A NEW subpath under src/ needs three things: the
 * file, a `packages/shared/package.json` "exports" entry, and an
 * `apps/api-server/tsconfig.json` "paths" entry; mobile jest maps
 * `@lantern/shared/*` subpaths separately, so a subpath imported only by a
 * test produces a CI-only TS2307 (reproduce with `jest --no-cache`). The web
 * turbo build compiles with strict `noUncheckedIndexedAccess`.
 */
import type { FeatureKey } from '../design';
import { AI_CREDIT_COSTS, AI_FEATURE_CREDIT_COST, formatCreditCost } from '../utils/aiCredits';
import { pluralize } from '../utils/plural';

/** AppIcon names that exist on both web and mobile maps. */
export type WorkspaceIconName =
  | 'document-text'
  | 'book'
  | 'layers'
  | 'help-circle'
  | 'clipboard'
  // A TEST is the one activity that ends in a mark, so it gets the clipboard
  // with the tick rather than the same clipboard a quiz and a plan already
  // share. Present in both icon maps (`components/ui/appIconMap.ts` and
  // `apps/mobile/src/components/ui/appIconMap.ts`).
  | 'clipboard-check'
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
  | 'library'
  // A study SET's own mark (`STUDY_SET_TILE` in studySets.ts). Already in both
  // icon maps; it joins the union so the set chip in studySetChrome.ts can
  // name it without a cast.
  | 'albums';

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
// ---------------------------------------------------------------------------
// The activity list: what you can do inside a set or course
// ---------------------------------------------------------------------------
// One row per activity, each with the icon both platforms have, a promise
// sentence, and a `ready`/`later` status. `later` activities are SHOWN and
// honestly marked rather than hidden — a student should be able to see where
// the product is going without being lied to about what works today.

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
    icon: 'clipboard-check',
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
    // The door is named for the feature (Tutor); the thing it produces is a
    // lesson. Home, the set room and the studio header all say Tutor now, so a
    // student never meets three names for one activity.
    label: 'Tutor',
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

export type TurnIntoTargetId =
  | 'cards'
  | 'quiz'
  | 'test'
  | 'notes'
  | 'lesson'
  | 'recap'
  | 'essay'
  | 'play';

export interface TurnIntoTarget {
  id: TurnIntoTargetId;
  label: string;
  promise: string;
  icon: WorkspaceIconName;
  feature: FeatureKey;
}

// ---------------------------------------------------------------------------
// Turn-into: converting one artefact into another
// ---------------------------------------------------------------------------
// Notes -> flashcards, notes -> quiz, and so on. Each target has an AI credit
// cost taken from ../utils/aiCredits (the single source of truth shared with
// the server) and formatted for display, so the price a student sees before
// tapping is the price the server actually charges.

export const TURN_INTO_TARGETS: readonly TurnIntoTarget[] = [
  {
    id: 'cards',
    label: 'Flashcards',
    promise: 'A deck filed in this set',
    icon: 'layers',
    feature: 'flashcards',
  },
  {
    id: 'quiz',
    label: 'Quiz',
    promise: 'An adaptive quiz from this material',
    icon: 'help-circle',
    feature: 'tests',
  },
  {
    id: 'test',
    label: 'Practice test',
    promise: 'A saved test you can sit again',
    icon: 'clipboard-check',
    feature: 'tests',
  },
  {
    id: 'notes',
    label: 'Notes',
    promise: 'Open this material in the notes room',
    icon: 'document-text',
    feature: 'notes',
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
 * `cards`, `quiz` and `test` run a generation job. `lesson`, `recap` and
 * `essay` open a studio whose first request sits behind
 * `aiRateLimitForFeature`, which charges exactly one AI use. `notes` and
 * `play` do not call a model from the menu.
 */
export const TURN_INTO_COST: Record<TurnIntoTargetId, number> = {
  cards: AI_CREDIT_COSTS.generate_flashcards,
  quiz: AI_CREDIT_COSTS.generate_questions,
  test: AI_CREDIT_COSTS.generate_questions,
  notes: 0,
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

// ---------------------------------------------------------------------------
// Recents (local only)
// ---------------------------------------------------------------------------
// A short most-recently-used list persisted under WORKSPACE_RECENTS_STORAGE_KEY
// on the device. Never synced — it is a convenience, not user data.

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

// ---------------------------------------------------------------------------
// Filing and counting
// ---------------------------------------------------------------------------
// Which course an item is filed under (tolerating both camelCase and the
// snake_case the API returns), and the count/label derivations the workspace
// header shows. Counts are formatted, never invented: a zero is rendered as
// absence rather than as "0 notes".

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
  const parts = [pluralize(notes, 'note'), pluralize(decks, 'deck')];
  if (tests > 0) {
    parts.push(pluralize(tests, 'test'));
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

// ---------------------------------------------------------------------------
// Scope: the same screen, for a set or for a course
// ---------------------------------------------------------------------------
// The workspace renders over either a personal study set or a course. The copy
// differs by one noun, so the noun is a parameter and SCOPED_COPY holds the
// pairs — that is cheaper than two copies of every string drifting apart.

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

/**
 * The counts line under a study set card, on Home and in the Study hub.
 *
 * Both screens hand-rolled the same template literal and both got it wrong the
 * same way: "1 materials" was unguarded, the note count was printed twice
 * (once as "materials", once as "notes"), and a count of DECKS was labelled
 * "cards" — so three decks holding two hundred flashcards read "3 cards".
 * One formatter, so the card says what it counts.
 */
export function formatStudySetCardCounts(counts: {
  notes: number;
  decks: number;
  lectures?: number;
}): string {
  const notes = Math.max(0, counts.notes ?? 0);
  const decks = Math.max(0, counts.decks ?? 0);
  const lectures = Math.max(0, counts.lectures ?? 0);
  if (notes === 0 && decks === 0) return 'No materials yet';
  const parts: string[] = [];
  if (notes > 0) parts.push(pluralize(notes, 'note'));
  if (lectures > 0) parts.push(pluralize(lectures, 'lecture'));
  if (decks > 0) parts.push(pluralize(decks, 'deck'));
  return parts.join(' · ');
}

/**
 * Copy that names the container the student is standing in.
 *
 * Every one of these lines existed twice — once saying "course", once saying
 * "set" — behind a `studySetId ? … : …` ternary at the call site, or worse,
 * only in the course wording on a screen a set can open. The scope is decided
 * once by `scopeNoun`, and the call site asks for a key.
 *
 * Copy that is genuinely course-only (enrolment, the lecturer, a class code,
 * a shared syllabus outline) is NOT in this table: a set has no lecturer, so
 * that wording stays where it is rather than being made scope-aware.
 */
const SCOPED_COPY = {
  notesEmpty: (s: WorkspaceScope) => `No notes in this ${s} yet`,
  testsEmpty: (s: WorkspaceScope) => `No tests from this ${s} yet`,
  decksEmpty: (s: WorkspaceScope) => `No decks in this ${s} yet. Turn a note into cards.`,
  importAction: (s: WorkspaceScope) => `Import into this ${s}`,
  testsFromDecks: (s: WorkspaceScope) =>
    `Turn a note into a practice test, or build one from this ${s}’s decks.`,
  buildingCards: (s: WorkspaceScope) => `Building flashcards for this ${s}…`,
  buildingTest: (s: WorkspaceScope) => `Building a practice test for this ${s}…`,
  lessonSourceEmpty: (s: WorkspaceScope) =>
    `Import or write a note in this ${s} first. The lesson is built from that material.`,
  recapSourceEmpty: (s: WorkspaceScope) =>
    `Import or write a note in this ${s} first. The recap is built from that material.`,
  essayPhotoImport: (s: WorkspaceScope) =>
    `Import the photo as a note in this ${s}, then load it here.`,
} as const;

export type ScopedCopyKey = keyof typeof SCOPED_COPY;

/** One scope-aware line. A set says "set"; a course says "course". */
export function scopedCopy(key: ScopedCopyKey, scope: WorkspaceScope = 'course'): string {
  return SCOPED_COPY[key](scope);
}
