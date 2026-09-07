/**
 * Course topics (Phase 1 · A) — the copy and the ordering, written once.
 *
 * A topic is one line of a course's syllabus outline. It belongs to exactly
 * one course, it is NOT a concept (concepts are the cross-course graph in
 * ./events), and it is SHARED course data: every student on the course reads
 * the same outline and may extend it. Rename, reorder and delete therefore
 * change what other people see, which is why the destructive copy below says
 * so out loud.
 *
 * Two things kept drifting while web and mobile each grew their own picker:
 *
 *  1. The wording. Web said "Topics aren’t set up for this course yet", mobile
 *     said "aren’t available"; the empty states, the placeholders and the
 *     error lines all differed by a word or two. Same product, two voices.
 *  2. The ordering. Three different tiebreaks shipped (position only, position
 *     then title, position then title then nothing) plus a web path that
 *     appended a freshly created topic to the end of an already-ordered list.
 *     An outline that reorders itself between screens reads as a bug.
 *
 * So: one copy object, one comparator. Both clients, both Library trees and
 * the api-server import from here rather than restating it.
 */

/**
 * Longest topic title we store. The api-server enforces it
 * (services/courseTopics.ts) and every input caps itself with THIS number —
 * a second copy of "120" somewhere is how a client starts silently posting
 * titles the server rejects.
 */
export const TOPIC_TITLE_MAX = 120;

/**
 * Every user-facing string for course topics. Plain strings, no i18n
 * framework — this codebase has none, and a lookup layer for one language is
 * cost without benefit. Add strings here rather than inline in a component.
 */
export const COURSE_TOPIC_COPY = {
  // ---------- Picker ----------
  /** Field label above the picker. */
  label: 'Topic',
  /** Trigger text with nothing chosen. Says "optional" because it is. */
  placeholder: 'Choose a topic (optional)',
  /** Trigger text before a course is chosen — a topic cannot exist without one. */
  noCourse: 'Pick a course first',
  /** An id we hold but cannot name yet (restored draft, outline still loading). */
  selectedUnknown: 'Topic selected',
  /** The row and the clear button that mean "filed under the course, under no topic". */
  none: 'No topic',
  /** Accessible name for the clear control. */
  clear: 'Clear topic',
  /** A topic row whose title came back blank. */
  untitled: 'Untitled topic',
  searchPlaceholder: 'Search or add a topic',
  /** Search placeholder when creating is impossible, so it promises nothing. */
  searchPlaceholderReadOnly: 'Search topics',
  loading: 'Loading topics…',
  /** In-flight label on the "Add ‘…’" row. */
  adding: 'Adding…',
  /** Nothing matched what was typed. */
  emptyMatch: 'No matching topic — type the full title to add it.',
  /** The outline exists but is empty. */
  empty: 'No topics yet — type a title to start this course’s outline.',
  /**
   * The outline could not be read at all. Reads as a fact about the course,
   * not as an error the user has to clear before saving the note they were
   * actually writing — topic is an optional field and must never block a save.
   */
  unavailable: 'Topics aren’t set up for this course yet.',
  createFailed: 'Could not add that topic',
  /** Mirrors the server's 23505 message so the user reads one sentence, not two. */
  duplicate: 'That topic already exists in this course',
  titleTooLong: `Topic titles can be up to ${TOPIC_TITLE_MAX} characters`,

  // ---------- Shared-outline framing ----------
  /**
   * The one line that explains why anyone may edit this. Shown under the
   * picker's create row and at the top of any manage-topics surface.
   */
  shared: 'Topics are shared — everyone taking this course sees the same outline.',

  // ---------- Manage: rename, reorder, delete ----------
  manageTitle: 'Course topics',
  /**
   * The outline is empty, seen from the manage surface — which now has its own
   * title field, so the line points at the field that is right there rather
   * than sending the student off to the Topic picker to find one.
   */
  manageEmpty: 'No topics yet. Add the first one above to start this course’s outline.',
  /** Heading and field for adding a topic in place, on the manage surface. */
  addTitle: 'Add a topic',
  addPlaceholder: 'Topic title',
  addAction: 'Add',
  rename: 'Rename topic',
  renameHint: 'Renaming changes this topic for everyone taking the course.',
  renameFailed: 'Could not rename that topic',
  reorder: 'Reorder topics',
  reorderHint: 'Reordering changes the outline for everyone taking this course.',
  reorderFailed: 'Could not save the new order',
  delete: 'Delete topic',
  deleteTitle: 'Delete this topic?',
  /**
   * Both halves of this are load-bearing. "Shared" so nobody deletes a topic
   * believing it is theirs alone, and "no work is lost" so nobody thinks the
   * button destroys their notes — deleting a topic only unfiles artefacts
   * (ON DELETE SET NULL); it never deletes anyone's notes, decks or tests.
   */
  deleteBody:
    'This outline is shared with everyone taking this course, so the topic disappears for them too. ' +
    'No work is lost: notes, decks and tests filed under it are only unfiled — they move to ‘No topic’ and stay exactly as they are.',
  deleteConfirm: 'Delete topic',
  deleteCancel: 'Cancel',
  deleteFailed: 'Could not delete that topic',

  // ---------- Seeding an empty outline ----------
  seed: 'Suggest topics from tags',
  seedHint: 'Builds a starting outline from the tags already used on this course.',
  /**
   * A seed run that suggested nothing — a course whose tags never cleared the
   * server's threshold. Reads as an honest empty result, not an error: typing a
   * title is still the way forward. Both pickers show this after `seed()`
   * returns `[]`, so the string lives here rather than inline in either client.
   */
  seedEmpty: 'No topics to suggest from this course’s tags yet — type a title to add one.',
  seedFailed: 'Could not suggest topics',

  // ---------- Library filter ----------
  /** Fallback chip label when the filtered topic's title is not loaded. */
  filterLabel: 'Topic',
  filterClearHint: 'Show every topic in this course',
} as const;

/** "Add ‘Gas exchange’" — the create row in both pickers. */
export function formatAddTopicOffer(title: string): string {
  return `Add ‘${String(title ?? '').trim()}’`;
}

/** "Delete ‘Gas exchange’?" — heading above {@link COURSE_TOPIC_COPY.deleteBody}. */
export function formatDeleteTopicTitle(title: string | null | undefined): string {
  const name = String(title ?? '').trim();
  return name ? `Delete ‘${name}’?` : COURSE_TOPIC_COPY.deleteTitle;
}

/**
 * The minimum a thing needs to be placed in an outline. Deliberately looser
 * than `CourseTopic`: the Library trees sort rows that arrive from an overview
 * payload, where a field can be missing on the wire even though the type says
 * otherwise.
 */
export interface CourseTopicOrderable {
  id?: string | null;
  title?: string | null;
  position?: number | null;
}

function positionOf(topic: CourseTopicOrderable | null | undefined): number {
  const position = topic?.position;
  return typeof position === 'number' && Number.isFinite(position) ? position : 0;
}

function titleOf(topic: CourseTopicOrderable | null | undefined): string {
  return typeof topic?.title === 'string' ? topic.title : '';
}

function idOf(topic: CourseTopicOrderable | null | undefined): string {
  return typeof topic?.id === 'string' ? topic.id : '';
}

/**
 * THE outline order: position ascending, then title (case-insensitive), then
 * id. Nothing else — every list of topics anywhere in the product sorts with
 * this, so the syllabus reads the same on the picker, the Library rail and the
 * mobile tree.
 *
 * Positions are sparse (10, 20, 30…) and assigned server-side, so they decide
 * almost every comparison. The title tiebreak only matters for topics created
 * in the same race, and the id tiebreak makes the order TOTAL: two equal
 * topics can never swap places between renders, whatever the engine's sort
 * stability.
 *
 * The title compare lower-cases before `localeCompare` instead of passing
 * `{ sensitivity: 'base' }`. Hermes ships without full Intl on some Android
 * builds and quietly ignores the options bag, which would give mobile a
 * different order from web — precisely the divergence this function exists to
 * end.
 */
export function compareCourseTopics(
  a: CourseTopicOrderable | null | undefined,
  b: CourseTopicOrderable | null | undefined
): number {
  const byPosition = positionOf(a) - positionOf(b);
  if (byPosition !== 0) return byPosition;

  const byTitle = titleOf(a).toLowerCase().localeCompare(titleOf(b).toLowerCase());
  if (byTitle !== 0) return byTitle;

  return idOf(a).localeCompare(idOf(b));
}

/** A new array in outline order. Never sorts in place — stores hand us their own arrays. */
export function sortCourseTopics<T extends CourseTopicOrderable>(topics: readonly T[]): T[] {
  return (Array.isArray(topics) ? [...topics] : []).sort(compareCourseTopics);
}

/**
 * Add or replace one topic and keep the outline ordered.
 *
 * A just-created topic lands at the end of the outline *today* because the
 * server hands it the next sparse position — but appending it blindly is what
 * broke the moment anyone reordered, so re-sort rather than assume.
 */
export function upsertCourseTopic<T extends CourseTopicOrderable>(topics: readonly T[], topic: T): T[] {
  const list = Array.isArray(topics) ? topics : [];
  const id = idOf(topic);
  if (!id) return [...list];
  const next = list.some((existing) => idOf(existing) === id)
    ? list.map((existing) => (idOf(existing) === id ? topic : existing))
    : [...list, topic];
  return sortCourseTopics(next);
}
