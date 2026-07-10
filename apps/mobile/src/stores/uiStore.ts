import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type LibraryTab = 'notes' | 'flashcards';

interface UIState {
  libraryTab: LibraryTab;
  setLibraryTab: (tab: LibraryTab) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      libraryTab: 'notes',
      setLibraryTab: (tab) => set({ libraryTab: tab }),
    }),
    {
      name: 'lantern-mobile-ui',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ libraryTab: state.libraryTab }),
    }
  )
);
