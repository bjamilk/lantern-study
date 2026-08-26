import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type LibraryTab = 'notes' | 'flashcards';

/**
 * Course filter picked in the Library tree and honoured by the Notes and
 * Flashcards tabs. `id` is a course uuid or the literal `'null'` for unfiled
 * items (the API's convention); `label` is what the chip shows.
 */
export interface LibraryCourseFilter {
  id: string;
  label: string;
  /**
   * Syllabus topic inside `id` (Phase 1 · A), or the literal 'null' for "in
   * this course, under no topic". Carried on the same object as the course so
   * the pair can never drift: replacing the course replaces the topic with it.
   */
  topicId?: string | null;
  topicLabel?: string;
}

interface UIState {
  libraryTab: LibraryTab;
  setLibraryTab: (tab: LibraryTab) => void;
  /** Session-only (not persisted): a stale course filter after relaunch would look like missing notes. */
  libraryCourseFilter: LibraryCourseFilter | null;
  setLibraryCourseFilter: (filter: LibraryCourseFilter | null) => void;
  /**
   * Whether the Library course tree is expanded. Persisted, unlike the course
   * filter above: this is chrome, not a filter, so a stale value can only cost
   * a tap — it can never hide content. Defaults to collapsed because an open
   * tree costs up to 300px and pushes the notes/decks list off a phone screen.
   */
  libraryTreeOpen: boolean;
  setLibraryTreeOpen: (open: boolean) => void;
  /**
   * Dashboard sections the student has collapsed, keyed by section id.
   *
   * A map rather than a field per section: the dashboard grows, and every new
   * panel would otherwise need a store field, a setter and a partialize entry.
   * Only COLLAPSED ids are stored, so a section absent from the map is open —
   * which means a new section ships expanded without a migration.
   *
   * Persisted: this is chrome, not a filter, so a stale value costs a tap and
   * can never hide content the student did not choose to hide.
   */
  collapsedDashboardSections: Record<string, boolean>;
  toggleDashboardSection: (id: string) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      libraryTab: 'notes',
      setLibraryTab: (tab) => set({ libraryTab: tab }),
      libraryCourseFilter: null,
      setLibraryCourseFilter: (libraryCourseFilter) => set({ libraryCourseFilter }),
      libraryTreeOpen: false,
      setLibraryTreeOpen: (libraryTreeOpen) => set({ libraryTreeOpen }),
      collapsedDashboardSections: {},
      toggleDashboardSection: (id) =>
        set((state) => {
          const next = { ...state.collapsedDashboardSections };
          // Delete rather than store `false`, so the map only ever holds what is
          // collapsed and cannot grow unbounded as sections come and go.
          if (next[id]) delete next[id];
          else next[id] = true;
          return { collapsedDashboardSections: next };
        }),
    }),
    {
      name: 'lantern-mobile-ui',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        libraryTab: state.libraryTab,
        libraryTreeOpen: state.libraryTreeOpen,
        collapsedDashboardSections: state.collapsedDashboardSections,
      }),
    }
  )
);
