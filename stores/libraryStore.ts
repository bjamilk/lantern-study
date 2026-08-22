/**
 * Library archive state (Phase 1 · B): the archive-wide course filter the
 * Library rail drives and the Notes / Flashcards / Offline screens read, plus a
 * cached `GET /library/overview` tree. The filter is a course uuid, the API's
 * literal `'null'` for unfiled items, or `null` for everything.
 *
 * The notes list mirrors this filter through NotesScreen (notesStore keeps its
 * own `courseFilterId` so other note surfaces can still load every note).
 */
import { create } from 'zustand';
import type { LibraryOverview } from '../types';
import { fetchLibraryOverview } from '../services/library';

interface LibraryState {
  /** Selected course in the Library rail / chips: uuid | 'null' (unfiled) | null (all). */
  courseFilterId: string | null;
  overview: LibraryOverview | null;
  overviewLoading: boolean;
  overviewError: string | null;
  /** Set by "move to course" style mutations so a mounted rail refetches counts. */
  overviewStale: boolean;
  /** Offline bundle to scroll to / highlight when Offline Mode next mounts (search deep link). */
  pendingOfflineBundleId: string | null;

  setCourseFilter: (courseId: string | null) => void;
  loadOverview: (options?: { force?: boolean }) => Promise<LibraryOverview | null>;
  invalidateOverview: () => void;
  setPendingOfflineBundleId: (bundleId: string | null) => void;
  reset: () => void;
}

let inflight: Promise<LibraryOverview | null> | null = null;

export const useLibraryStore = create<LibraryState>((set, get) => ({
  courseFilterId: null,
  overview: null,
  overviewLoading: false,
  overviewError: null,
  overviewStale: false,
  pendingOfflineBundleId: null,

  setCourseFilter: (courseId) => {
    const next = courseId || null;
    if (get().courseFilterId === next) return;
    set({ courseFilterId: next });
  },

  loadOverview: async (options) => {
    if (!options?.force && get().overview && !get().overviewStale) return get().overview;
    if (inflight) return inflight;
    set({ overviewLoading: true, overviewError: null });
    inflight = (async () => {
      try {
        const overview = await fetchLibraryOverview();
        set({ overview, overviewLoading: false, overviewStale: false });
        return overview;
      } catch (e: any) {
        set({ overviewLoading: false, overviewError: e?.message || 'Could not load your library' });
        return get().overview;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  },

  invalidateOverview: () => {
    if (!get().overviewStale) set({ overviewStale: true });
  },

  setPendingOfflineBundleId: (bundleId) => set({ pendingOfflineBundleId: bundleId || null }),

  reset: () => {
    inflight = null;
    set({
      courseFilterId: null,
      overview: null,
      overviewLoading: false,
      overviewError: null,
      overviewStale: false,
      pendingOfflineBundleId: null,
    });
  },
}));
