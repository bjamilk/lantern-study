/**
 * Practice folders for the set room — the folder list, and the optimistic
 * overlay that makes a move feel instant.
 *
 * ## Why its own store and not `testStore`
 *
 * `testStore` holds live sessions, results and the two offline queues. It has
 * never held the room's TEST LIST — that lives in `CourseWorkspace`'s
 * `fetchedTests`, merged from `/api/v1/tests` and locally completed attempts.
 * Filing state belongs beside neither: it is per-SET, it is written by four
 * user actions that all need rollback, and putting it in `testStore` would
 * couple sign-out's `reset()` (which deliberately preserves unsynced work) to
 * a cache that should simply be refetched. So: a small store of its own, which
 * is also what makes the optimistic rules below testable without a room.
 *
 * ## The capability
 *
 * `supported` starts `null` — UNKNOWN, not false. The hub draws no folder UI
 * while it is null or false, so the first paint before the fetch returns looks
 * exactly like today rather than flashing an empty folder row. `false` is the
 * settled pre-migration answer (20260918120000 is applied by hand), and it is
 * also what a FAILED fetch produces: a folder list that could not load must
 * not turn the hub into an error screen.
 *
 * ## The optimistic rules
 *
 * Every mutation writes local state first and rolls back the exact previous
 * value on failure — not a refetch, which would race a second edit.
 *
 * `moves` is an OVERLAY keyed by test id, not a rewrite of the test rows: the
 * room owns those and refetches them on its own schedule, so a store that
 * edited them would have its work silently overwritten. `folderIdFor` is how
 * a surface reads the two together, and it is the only correct way to.
 *
 * ## Gotcha
 *
 * A failed move rolls the overlay back to what it was, which may be
 * `undefined` (meaning "no local opinion — read the server's value"), NOT
 * null (meaning "unfiled"). Writing null on rollback would silently unfile an
 * item whose move merely failed.
 */
import { create } from 'zustand';
import {
  normalizePracticeFolderTitle,
  type PracticeFiledItem,
  type PracticeFolderWithCount,
} from '@lantern/shared/study/practiceFolders';
import {
  createPracticeFolder as apiCreate,
  deletePracticeFolder as apiDelete,
  fetchPracticeFolders,
  movePracticeItem as apiMove,
  renamePracticeFolder as apiRename,
} from '../services/academic';

interface PracticeFolderState {
  /** null while unknown; false pre-migration or after a failed load. */
  supported: boolean | null;
  /** The set these folders belong to, so a room switch cannot show stale ones. */
  setId: string | null;
  folders: PracticeFolderWithCount[];
  /** testId → folder id (or null for unfiled). Absent = no local opinion. */
  moves: Record<string, string | null>;
  loading: boolean;

  loadFolders: (setId: string) => Promise<void>;
  createFolder: (setId: string, title: string) => Promise<PracticeFolderWithCount | null>;
  renameFolder: (setId: string, folderId: string, title: string) => Promise<boolean>;
  removeFolder: (setId: string, folderId: string) => Promise<boolean>;
  moveItem: (setId: string, testId: string, folderId: string | null) => Promise<boolean>;
  /** Forget everything — called when the room switches sets. */
  reset: () => void;
}

export const usePracticeFolderStore = create<PracticeFolderState>()((set, get) => ({
  supported: null,
  setId: null,
  folders: [],
  moves: {},
  loading: false,

  loadFolders: async (setId) => {
    // Switching rooms clears the previous set's folders BEFORE the fetch, so
    // BIO 201's folders never appear for a moment over CHM 101's practice.
    if (get().setId !== setId) {
      set({ setId, folders: [], moves: {}, supported: null });
    }
    set({ loading: true });
    const payload = await fetchPracticeFolders(setId);
    // A room the student left while this was in flight must not be overwritten.
    if (get().setId !== setId) return;
    set({ supported: payload.supported, folders: payload.folders, loading: false });
  },

  createFolder: async (setId, title) => {
    try {
      const created = await apiCreate(setId, normalizePracticeFolderTitle(title));
      set((state) => ({
        folders: [created, ...state.folders.filter((row) => row.id !== created.id)],
      }));
      return created;
    } catch {
      // Nothing was shown optimistically — a folder with no server id cannot
      // be renamed, deleted or moved into, so an optimistic one would be a
      // card that refuses every action it offers.
      return null;
    }
  },

  renameFolder: async (setId, folderId, title) => {
    const next = normalizePracticeFolderTitle(title);
    const previous = get().folders.find((row) => row.id === folderId);
    if (!previous) return false;
    set((state) => ({
      folders: state.folders.map((row) => (row.id === folderId ? { ...row, title: next } : row)),
    }));
    try {
      await apiRename(setId, folderId, next);
      return true;
    } catch {
      set((state) => ({
        folders: state.folders.map((row) =>
          row.id === folderId ? { ...row, title: previous.title } : row
        ),
      }));
      return false;
    }
  },

  removeFolder: async (setId, folderId) => {
    const previous = get().folders;
    const at = previous.findIndex((row) => row.id === folderId);
    if (at === -1) return false;
    set({ folders: previous.filter((row) => row.id !== folderId) });
    try {
      await apiDelete(setId, folderId);
      // The contents are KEPT and unfiled by the server's ON DELETE SET NULL,
      // so every local move into this folder now points at nothing. Rewriting
      // them to null is what stops those items vanishing from both the folder
      // (gone) and the top level (still filed) until the next refetch.
      set((state) => {
        const moves = { ...state.moves };
        for (const [testId, value] of Object.entries(moves)) {
          if (value === folderId) moves[testId] = null;
        }
        return { moves };
      });
      return true;
    } catch {
      set({ folders: previous });
      return false;
    }
  },

  moveItem: async (setId, testId, folderId) => {
    const had = Object.prototype.hasOwnProperty.call(get().moves, testId);
    const previous = get().moves[testId];
    set((state) => ({ moves: { ...state.moves, [testId]: folderId } }));
    try {
      await apiMove(setId, testId, folderId);
      return true;
    } catch {
      set((state) => {
        const moves = { ...state.moves };
        // `undefined` and `null` are different answers — see the header.
        if (had) moves[testId] = previous as string | null;
        else delete moves[testId];
        return { moves };
      });
      return false;
    }
  },

  reset: () => set({ supported: null, setId: null, folders: [], moves: {}, loading: false }),
}));

/**
 * The folder an item is in, reading the optimistic overlay over the server's
 * value — the only correct way to read the two together.
 *
 * Returns `undefined` when the row predates the migration and there is no
 * local move, preserving the absent-vs-null distinction all the way to the
 * component: absent means "this database cannot file practice", which draws
 * no folder UI at all.
 */
export function folderIdFor(
  item: PracticeFiledItem,
  moves: Record<string, string | null>
): string | null | undefined {
  return Object.prototype.hasOwnProperty.call(moves, item.id)
    ? moves[item.id]
    : item.practiceFolderId;
}

/** Apply the overlay to a list of items, so a surface can filter them directly. */
export function withPracticeFolders<T extends PracticeFiledItem>(
  items: readonly T[],
  moves: Record<string, string | null>
): T[] {
  return items.map((item) => {
    const folderId = folderIdFor(item, moves);
    return folderId === undefined ? item : { ...item, practiceFolderId: folderId };
  });
}
