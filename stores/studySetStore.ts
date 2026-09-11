import { create } from 'zustand';
import type { StudySet } from '@lantern/shared';
import {
  createStudySet as apiCreate,
  deleteStudySet as apiDelete,
  fetchMyStudySets,
  updateStudySet as apiUpdate,
} from '../services/academic';

const LAST_OPENED_KEY = 'lantern.lastStudySetId';

function readLastOpenedId(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(LAST_OPENED_KEY);
  } catch {
    return null;
  }
}

interface StudySetState {
  sets: StudySet[];
  loaded: boolean;
  loading: boolean;
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

let inflight: Promise<StudySet[]> | null = null;

export const useStudySetStore = create<StudySetState>((set, get) => ({
  sets: [],
  loaded: false,
  loading: false,
  lastOpenedId: readLastOpenedId(),
  picker: false,

  loadSets: async (options) => {
    if (get().loaded && !options?.force) return get().sets;
    if (inflight) return inflight;
    set({ loading: true });
    inflight = fetchMyStudySets()
      .then((rows) => {
        const sets = Array.isArray(rows) ? rows : [];
        set({ sets, loaded: true, loading: false });
        return sets;
      })
      .catch((error: unknown) => {
        set({ loading: false });
        throw error;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  },

  createSet: async (input) => {
    const created = await apiCreate(input);
    set({ sets: [created, ...get().sets.filter((row) => row.id !== created.id)], loaded: true });
    get().touchOpened(created.id);
    return created;
  },

  updateSet: async (setId, patch) => {
    const updated = await apiUpdate(setId, patch);
    set({
      sets: get().sets.map((row) => (row.id === setId ? updated : row)),
    });
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
    try {
      localStorage.setItem(LAST_OPENED_KEY, id);
    } catch {
      // Quota or private mode — last-opened is a convenience.
    }
    set({ lastOpenedId: id, picker: false });
  },

  openPicker: () => set({ picker: true }),
  closePicker: () => set({ picker: false }),
}));
