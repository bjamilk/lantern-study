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
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      libraryTab: 'notes',
      setLibraryTab: (tab) => set({ libraryTab: tab }),
      libraryCourseFilter: null,
      setLibraryCourseFilter: (libraryCourseFilter) => set({ libraryCourseFilter }),
    }),
    {
      name: 'lantern-mobile-ui',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ libraryTab: state.libraryTab }),
    }
  )
);
