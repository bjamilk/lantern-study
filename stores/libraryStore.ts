/**
 * Library archive state (Phase 1 · B): the archive-wide course filter the
 * Library rail drives and the Notes / Flashcards / Offline screens read, plus a
 * cached `GET /library/overview` tree. The filter is a course uuid, the API's
 * literal `'null'` for unfiled items, or `null` for everything, optionally
 * narrowed to one topic inside that course (Phase 1 · A).
 *
 * The notes list mirrors this filter through NotesScreen (notesStore keeps its
 * own `courseFilterId` so other note surfaces can still load every note).
 */
import { create } from 'zustand';
import type { LibraryOverview } from '../types';
import { fetchLibraryOverview } from '../services/library';
import { UNFILED_COURSE_ID } from '../utils/libraryArchive';

interface LibraryState {
  /** Selected course in the Library rail / chips: uuid | 'null' (unfiled) | null (all). */
  courseFilterId: string | null;
  /**
   * Selected topic *within* `courseFilterId`: uuid | 'null' (in the course, no
   * topic) | null (the whole course). Never set without a real course.
   */
  topicFilterId: string | null;
  /**
   * The selected topic's title, kept here rather than re-derived from the
   * overview tree. The tree can stop containing the row while the filter is
   * still live — "No topic" disappears once its last item is filed, another
   * device can rename or delete a topic — and a label that vanishes takes the
   * "Whole course" escape hatch with it while results stay narrowed.
   */
  topicFilterLabel: string | null;
  overview: LibraryOverview | null;
  overviewLoading: boolean;
  overviewError: string | null;
  /** Set by "move to course" style mutations so a mounted rail refetches counts. */
  overviewStale: boolean;
  /** Offline bundle to scroll to / highlight when Offline Mode next mounts (search deep link). */
  pendingOfflineBundleId: string | null;

  setCourseFilter: (courseId: string | null) => void;
  /**
   * Selecting a topic sets both halves — a topic outside its course is not a
   * valid filter. `topicLabel` is what the chips show; pass it whenever the
   * caller knows the title (every picker does).
   */
  setTopicFilter: (courseId: string | null, topicId: string | null, topicLabel?: string | null) => void;
  loadOverview: (options?: { force?: boolean }) => Promise<LibraryOverview | null>;
  invalidateOverview: () => void;
  setPendingOfflineBundleId: (bundleId: string | null) => void;
  reset: () => void;
}

let inflight: Promise<LibraryOverview | null> | null = null;

export const useLibraryStore = create<LibraryState>((set, get) => ({
  courseFilterId: null,
  topicFilterId: null,
  topicFilterLabel: null,
  overview: null,
  overviewLoading: false,
  overviewError: null,
  overviewStale: false,
  pendingOfflineBundleId: null,

  setCourseFilter: (courseId) => {
    const next = courseId || null;
    if (get().courseFilterId === next && !get().topicFilterId) return;
    // Picking (or clearing) a course drops the topic: it only existed inside the old course.
    set({ courseFilterId: next, topicFilterId: null, topicFilterLabel: null });
  },

  setTopicFilter: (courseId, topicId, topicLabel) => {
    const nextCourse = courseId || null;
    // 'null' means "unfiled", which has no topics — so only a real course carries one.
    const nextTopic = nextCourse && nextCourse !== UNFILED_COURSE_ID ? topicId || null : null;
    // A caller that omits the label is re-asserting the same selection (a
    // mirrored effect, a restored filter); a *different* topic with no label is
    // all we can honestly show.
    const unchanged = get().courseFilterId === nextCourse && get().topicFilterId === nextTopic;
    const nextLabel = nextTopic
      ? topicLabel || (unchanged ? get().topicFilterLabel : null) || 'Topic'
      : null;
    if (
      get().courseFilterId === nextCourse &&
      get().topicFilterId === nextTopic &&
      get().topicFilterLabel === nextLabel
    ) {
      return;
    }
    set({ courseFilterId: nextCourse, topicFilterId: nextTopic, topicFilterLabel: nextLabel });
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
      topicFilterId: null,
      topicFilterLabel: null,
      overview: null,
      overviewLoading: false,
      overviewError: null,
      overviewStale: false,
      pendingOfflineBundleId: null,
    });
  },
}));
