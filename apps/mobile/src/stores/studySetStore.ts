import { create } from 'zustand';
import type { StudySet } from '@lantern/shared/types';
import {
  createStudySet as apiCreate,
  deleteStudySet as apiDelete,
  fetchMyStudySets,
  updateStudySet as apiUpdate,
} from '../services/academic';

interface StudySetState {
  sets: StudySet[];
  loaded: boolean;
  lastOpenedId: string | null;
  picker: boolean;
  loadSets: (options?: { force?: boolean }) => Promise<StudySet[]>;
  createSet: (input: { title: string; courseId?: string | null }) => Promise<StudySet>;
  updateSet: (setId: string, patch: { title?: string; courseId?: string | null }) => Promise<StudySet>;
  removeSet: (setId: string) => Promise<void>;
  resolveSet: (setId: string | null | undefined) => StudySet | null;
  touchOpened: (setId: string) => void;
  openPicker: () => void;
  closePicker: () => void;
}

export const useStudySetStore = create<StudySetState>((set, get) => ({
  sets: [],
  loaded: false,
  lastOpenedId: null,
  picker: false,

  loadSets: async (options) => {
    if (get().loaded && !options?.force) return get().sets;
    const rows = await fetchMyStudySets().catch(() => [] as StudySet[]);
    const sets = Array.isArray(rows) ? rows : [];
    set({ sets, loaded: true });
    return sets;
  },

  createSet: async (input) => {
    const created = await apiCreate(input);
    set({
      sets: [created, ...get().sets.filter((row) => row.id !== created.id)],
      loaded: true,
      lastOpenedId: created.id,
      picker: false,
    });
    return created;
  },

  updateSet: async (setId, patch) => {
    const updated = await apiUpdate(setId, patch);
    set({ sets: get().sets.map((row) => (row.id === setId ? updated : row)) });
    return updated;
  },

  removeSet: async (setId) => {
    await apiDelete(setId);
    set({ sets: get().sets.filter((row) => row.id !== setId) });
  },

  resolveSet: (setId) => get().sets.find((row) => row.id === setId) ?? null,

  touchOpened: (setId) => {
    const id = setId.trim();
    if (!id) return;
    set({ lastOpenedId: id, picker: false });
  },

  openPicker: () => set({ picker: true }),
  closePicker: () => set({ picker: false }),
}));
