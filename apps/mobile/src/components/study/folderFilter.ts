/**
 * Folders on the Study hub — the rules, with no React in them.
 *
 * Web has had folders on its hub since the study-set list shipped: a chip row
 * of `All` plus one chip per folder, a `Create folder` control, and
 * `Move to folder` in each card's kebab. The phone had the STORE half of it
 * (`loadFolders`, and a `folderId` the PATCH already accepted) and none of the
 * surface, so a student who filed twelve sets into four folders on a laptop
 * opened the phone to one undifferentiated list and no way to file anything.
 *
 * Everything decidable without a screen lives here so it can be tested without
 * mounting react-native, and so the phone and the browser answer the same
 * questions the same way:
 *
 * - which chips the row draws, and which one is on;
 * - what a selection MEANS when the folder behind it is gone (it means `All` —
 *   a chip pointing at a deleted folder would filter the list down to nothing
 *   and give the student no clue why);
 * - which sets a selection admits;
 * - what the move sheet offers, including the `No folder` row, and which row
 *   is the set's current home.
 */

import type { StudySetFolder } from '@lantern/shared/types';

/**
 * The selection that filters nothing.
 *
 * A sentinel rather than `null` because it is also a chip id and an
 * `AsyncStorage` value: one spelling for all three beats three ways to say the
 * same thing, and `'all'` is the id web's hub uses too.
 */
export const ALL_FOLDERS = 'all';

/** Either `ALL_FOLDERS` or a folder's id. */
export type FolderSelection = string;

/** The server's own limit (`POST /users/me/study-sets/folders`: 1–80). */
export const FOLDER_TITLE_MAX = 80;

export function normalizeFolderTitle(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, FOLDER_TITLE_MAX);
}

export function isValidFolderTitle(title: string): boolean {
  const normalized = normalizeFolderTitle(title);
  return normalized.length >= 1 && normalized.length <= FOLDER_TITLE_MAX;
}

/**
 * The selection to actually act on.
 *
 * A remembered chip outlives the folder it names: delete a folder on the
 * laptop, come back to a phone still holding its id, and the unresolved
 * selection hides every set behind a chip that is not even drawn any more.
 * Resolving first means the worst case is "the filter fell back to All",
 * which is visible on screen.
 */
export function resolveFolderSelection(
  selection: FolderSelection | null | undefined,
  folders: readonly StudySetFolder[]
): FolderSelection {
  const wanted = (selection ?? '').trim();
  if (!wanted || wanted === ALL_FOLDERS) return ALL_FOLDERS;
  return folders.some((folder) => folder.id === wanted) ? wanted : ALL_FOLDERS;
}

export interface FolderChip {
  /** `ALL_FOLDERS` or the folder id. */
  id: FolderSelection;
  label: string;
  selected: boolean;
}

/**
 * The chip row: `All` first, then the folders in the order the server sent
 * them (newest first, as `listFolders` orders it) — so a folder made a moment
 * ago is the first one under the thumb rather than the last.
 *
 * A folder with a blank title still gets a chip, labelled `Untitled folder`:
 * an unlabelled chip is a tap target with nothing to read.
 */
export function folderChips(
  folders: readonly StudySetFolder[],
  selection: FolderSelection | null | undefined
): FolderChip[] {
  const active = resolveFolderSelection(selection, folders);
  return [
    { id: ALL_FOLDERS, label: 'All', selected: active === ALL_FOLDERS },
    ...folders.map((folder) => ({
      id: folder.id,
      label: folderLabel(folder),
      selected: active === folder.id,
    })),
  ];
}

export function folderLabel(folder: StudySetFolder | null | undefined): string {
  const title = (folder?.title ?? '').trim();
  return title || 'Untitled folder';
}

/** The name of the selected folder, or null under `All`. */
export function selectedFolderLabel(
  folders: readonly StudySetFolder[],
  selection: FolderSelection | null | undefined
): string | null {
  const active = resolveFolderSelection(selection, folders);
  if (active === ALL_FOLDERS) return null;
  return folderLabel(folders.find((folder) => folder.id === active) ?? null);
}

/** Anything with a folder — the hub filters ROWS, not bare sets. */
export interface Foldered {
  folderId?: string | null;
}

/**
 * The sets one selection admits, in the order given.
 *
 * `All` returns the same array contents rather than a filtered copy of a
 * predicate that happens to pass everything, so the common case does no work
 * per set. A set whose `folderId` is absent, null or blank is unfiled, and
 * unfiled sets appear under `All` only — the same rule web applies.
 */
export function filterByFolder<T extends Foldered>(
  rows: readonly T[],
  selection: FolderSelection | null | undefined,
  folders: readonly StudySetFolder[] = []
): T[] {
  const active = folders.length
    ? resolveFolderSelection(selection, folders)
    : (selection ?? ALL_FOLDERS).trim() || ALL_FOLDERS;
  if (active === ALL_FOLDERS) return [...rows];
  return rows.filter((row) => (row.folderId ?? '') === active);
}

/**
 * How many sets sit in each folder, plus the unfiled count under
 * `ALL_FOLDERS`. Used to tell an empty folder ("nothing filed here yet") from
 * an empty search, which are different dead ends with different ways out.
 */
export function folderCounts(rows: readonly Foldered[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = (row.folderId ?? '').trim() || ALL_FOLDERS;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export interface MoveTarget {
  /** The `folderId` to PATCH — `null` unfiles the set. */
  folderId: string | null;
  label: string;
  /** True when the set already lives here. The sheet ticks it, not hides it. */
  current: boolean;
}

/**
 * What the `Move to folder…` sheet offers for one set.
 *
 * `No folder` comes FIRST and is always present, including for a set that is
 * already unfiled: a move sheet whose only rows are folders is a sheet you
 * cannot back out of, and "take it out of this folder" is the move a student
 * most often wants after filing the wrong thing. The set's current home is
 * marked rather than dropped, so the sheet answers "where is this?" as well as
 * "where should it go?".
 */
export function moveTargets(
  folders: readonly StudySetFolder[],
  currentFolderId: string | null | undefined
): MoveTarget[] {
  const current = (currentFolderId ?? '').trim();
  return [
    { folderId: null, label: 'No folder', current: current === '' },
    ...folders.map((folder) => ({
      folderId: folder.id,
      label: folderLabel(folder),
      current: current === folder.id,
    })),
  ];
}

/** The toast after a move landed. Names the destination, never just "Moved". */
export function movedMessage(target: MoveTarget): string {
  return target.folderId === null
    ? 'Removed from its folder.'
    : `Moved to ${target.label}.`;
}

/**
 * Where a move lands the hub's own filter.
 *
 * Moving a set OUT of the folder you are looking at makes it vanish from the
 * list under your thumb, which reads as a delete. So the filter follows the
 * set: after a move, the selection becomes the destination (or `All`, when the
 * set was unfiled) — the student keeps looking at the thing they just moved.
 * Only when they were on `All` does nothing change, because nothing needs to.
 */
export function selectionAfterMove(
  selection: FolderSelection | null | undefined,
  target: MoveTarget
): FolderSelection {
  const active = (selection ?? ALL_FOLDERS).trim() || ALL_FOLDERS;
  if (active === ALL_FOLDERS) return ALL_FOLDERS;
  return target.folderId ?? ALL_FOLDERS;
}

/**
 * The empty-list line under a folder chip.
 *
 * Returns null when the hub should draw its ordinary empty state (no sets at
 * all, or no search match) — this sentence is only for "you are inside a
 * folder and THAT is why the list is short".
 */
export function emptyFolderLine(
  folders: readonly StudySetFolder[],
  selection: FolderSelection | null | undefined
): string | null {
  const label = selectedFolderLabel(folders, selection);
  return label ? `Nothing filed in ${label} yet. Move a set here from its card menu.` : null;
}
