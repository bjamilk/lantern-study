/**
 * Practice folders — the shape both clients read, and the rules neither may
 * re-derive.
 *
 * ## Why this file exists
 *
 * PR #130 unified the quiz and test libraries into one Practice hub and found
 * there was nothing to file them INTO: quizzes and tests are rows of ONE table
 * (`test_sessions` — there is no `tests` table), and no row carried a folder.
 * The only folders in reach were `StudySetFolder`, which group SETS; drawing
 * one beside the quizzes produced a card that read "<name> · Folder" and, when
 * clicked, LEFT the room. `PracticeFolder` is the real thing: a folder that
 * lives inside one study set and holds that set's quizzes and tests together.
 *
 * ## The capability, and why it is on the payload
 *
 * Migration `20260918120000_practice_folders.sql` is applied BY HAND, and the
 * API deploys before it lands. So the list endpoint answers with
 * `supported: false` and no folders until the column exists, and both clients
 * draw the hub exactly as they draw it today. `supported` is a FIELD, not an
 * inference from an empty list: "this account has no folders yet" and "this
 * database cannot hold folders yet" are different answers and the first one
 * must still show a Create folder card.
 *
 * ## The one rule a client must not re-derive
 *
 * A folder holds BOTH doors. `studyTestDoor` (createFromSource.ts) decides
 * whether a row is a quiz or a test, and that is orthogonal to its folder —
 * `practiceItemsInFolder` is what every surface counts with, so the Tests tab
 * and the All tab cannot disagree about how many items a folder holds.
 */

/** A folder inside one study set, holding that set's quizzes and tests. */
export interface PracticeFolder {
  id: string;
  /** The set this folder lives in. A folder is never account-wide. */
  studySetId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A folder as the server hands it back, with the number the card prints.
 *
 * The count is SERVER-side on purpose: a client only ever holds one page of
 * practice rows, so counting locally would print "Folder · 3 items" over a
 * folder that holds thirty.
 */
export interface PracticeFolderWithCount extends PracticeFolder {
  itemCount: number;
}

/**
 * What `GET /users/me/study-sets/:setId/practice-folders` answers.
 *
 * `supported: false` means the hand-applied migration has not landed on this
 * database; `folders` is then always empty and every write answers 503.
 */
export interface PracticeFolderListResponse {
  supported: boolean;
  folders: PracticeFolderWithCount[];
}

/** The longest a folder title may be — the same 80 the server's CHECK enforces. */
export const PRACTICE_FOLDER_TITLE_MAX = 80;

/** The migration that must be hand-applied before any of this does anything. */
export const PRACTICE_FOLDER_MIGRATION = '20260918120000_practice_folders.sql';

/**
 * Is this a title the server will accept? Clients call it before the request
 * so a blank rename is refused in the dialog rather than by a 400.
 */
export function isValidPracticeFolderTitle(title: string): boolean {
  const trimmed = title.trim();
  return trimmed.length >= 1 && trimmed.length <= PRACTICE_FOLDER_TITLE_MAX;
}

/** The exact title the server will store, so the optimistic card matches it. */
export function normalizePracticeFolderTitle(title: string): string {
  return title.trim().slice(0, PRACTICE_FOLDER_TITLE_MAX);
}

/** Anything a surface can file: an id, and the folder it currently sits in. */
export interface PracticeFiledItem {
  id: string;
  /**
   * `undefined` means "this row was read from a database without the column"
   * — the same absent-vs-null rule `topicId` uses. `null` means "unfiled".
   * A client that collapses the two reports every item as unfiled the day
   * before the migration lands.
   */
  practiceFolderId?: string | null;
}

/**
 * The items of one folder, in the order they were given.
 *
 * The empty-id guard is not defensive noise: without it a caller that passes
 * `null` — a "no folder open" state that leaked one level down — matches every
 * UNFILED row by `null === null` and renders the top level as the contents of
 * a folder that is not open. Caught by this file's own test.
 */
export function practiceItemsInFolder<T extends PracticeFiledItem>(
  items: readonly T[],
  folderId: string,
): T[] {
  if (!folderId) return [];
  return items.filter((item) => item.practiceFolderId === folderId);
}

/** The items sitting at the top level of the hub — everything not in a folder. */
export function practiceItemsUnfiled<T extends PracticeFiledItem>(items: readonly T[]): T[] {
  return items.filter((item) => !item.practiceFolderId);
}

/**
 * "Folder · 3 items" — the second line of a folder card, measured off the
 * reference (docs/studyfetch-mysets-2026-09-17/02-style-and-subpages.md,
 * §Materials). One function because the hub, the breadcrumb and mobile all
 * print it, and three copies of a pluralisation drift.
 */
export function practiceFolderMeta(itemCount: number): string {
  return `Folder · ${itemCount} ${itemCount === 1 ? 'item' : 'items'}`;
}
