/**
 * One view switch for the Notes list.
 *
 * Mine | Shared and Active | Archived were two binary controls — four
 * combinations on the way to the first note. Almost every session is "my
 * active notes". Shared and Archived are destinations, not halves of a pair.
 */

export const NOTES_LIST_VIEWS = ['mine', 'shared', 'archived'] as const;

export type NotesListView = (typeof NOTES_LIST_VIEWS)[number];

export const NOTES_LIST_VIEW_OPTIONS: ReadonlyArray<{ id: NotesListView; label: string }> = [
  { id: 'mine', label: 'Mine' },
  { id: 'shared', label: 'Shared' },
  { id: 'archived', label: 'Archived' },
];

export function noteIsOwned(note: { accessRole?: string | null }): boolean {
  return !note.accessRole || note.accessRole === 'owner';
}

export function noteMatchesListView(
  note: { accessRole?: string | null; isArchived?: boolean | null },
  view: NotesListView,
): boolean {
  const archived = Boolean(note.isArchived);
  if (view === 'archived') return archived;
  if (archived) return false;
  const mine = noteIsOwned(note);
  return view === 'mine' ? mine : !mine;
}
