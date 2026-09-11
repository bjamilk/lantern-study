import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { StudySet } from '@lantern/shared/types';
import {
  createStudySet as apiCreate,
  deleteStudySet as apiDelete,
  fetchMyStudySets,
  updateStudySet as apiUpdate,
} from '../services/academic';

const LAST_OPENED_KEY = 'lantern.lastStudySetId';

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
  lastOpenedId: null as string | null,
  picker: false,

  loadSets: async (options) => {
    if (get().loaded && !options?.force) return get().sets;
    const [rows, stored] = await Promise.all([
      fetchMyStudySets().catch(() => [] as StudySet[]),
      AsyncStorage.getItem(LAST_OPENED_KEY).catch(() => null),
    ]);
    const sets = Array.isArray(rows) ? rows : [];
    set({
      sets,
      loaded: true,
      lastOpenedId: get().lastOpenedId || stored,
    });
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
    void AsyncStorage.setItem(LAST_OPENED_KEY, id).catch(() => undefined);
  },

  openPicker: () => set({ picker: true }),
  closePicker: () => set({ picker: false }),
}));
