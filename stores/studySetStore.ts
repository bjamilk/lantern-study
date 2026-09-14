import { create } from 'zustand';
import type { StudySet, StudySetFolder } from '@lantern/shared';
import {
  createStudySet as apiCreate,
  createStudySetFolder as apiCreateFolder,
  deleteStudySet as apiDelete,
  deleteStudySetFolder as apiDeleteFolder,
  fetchMyStudySets,
  fetchStudySetFolders,
  touchStudySet as apiTouch,
  updateStudySet as apiUpdate,
} from '../services/academic';
import { useAuthStore } from './authStore';

const LAST_OPENED_KEY = 'lantern.lastStudySetId';

export function studySetCacheKey(userId: string): string {
  return `lantern.studySets.cache:${userId}`;
}

interface CachedStudySets {
  sets: StudySet[];
  syncedAt: string;
}

function currentUserId(): string | null {
  return useAuthStore.getState().currentUser?.id ?? null;
}

function readCache(): CachedStudySets | null {
  const userId = currentUserId();
  if (!userId || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(studySetCacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedStudySets> | null;
    if (!parsed || !Array.isArray(parsed.sets)) return null;
    return { sets: parsed.sets, syncedAt: String(parsed.syncedAt ?? '') };
  } catch {
    return null;
  }
}

function writeCache(sets: StudySet[]): void {
  const userId = currentUserId();
  if (!userId || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      studySetCacheKey(userId),
      JSON.stringify({ sets, syncedAt: new Date().toISOString() } satisfies CachedStudySets)
    );
  } catch {
    // Quota or private mode — the live list still works this session.
  }
}

function loadErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.trim() || 'Could not load study sets';
}

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
  folders: StudySetFolder[];
  loaded: boolean;
  loading: boolean;
  /** Set when the list request failed. Empty-library is only honest after a success. */
  loadError: string | null;
  lastOpenedId: string | null;
  picker: boolean;
  loadSets: (options?: { force?: boolean }) => Promise<StudySet[]>;
  createSet: (input: {
    title: string;
    courseId?: string | null;
    description?: string | null;
    folderId?: string | null;
  }) => Promise<StudySet>;
  updateSet: (
    setId: string,
    patch: {
      title?: string;
      courseId?: string | null;
      description?: string | null;
      folderId?: string | null;
      visibility?: 'private' | 'public';
      mode?: 'cram' | 'standard' | 'comprehensive';
      /** The tile pick; `null` resets that half to the derivation. */
      tileHue?: string | null;
      tileGlyph?: string | null;
    }
  ) => Promise<StudySet>;
  removeSet: (setId: string) => Promise<void>;
  resolveSet: (setId: string | null | undefined) => StudySet | null;
  touchOpened: (setId: string) => void;
  openPicker: () => void;
  closePicker: () => void;
  loadFolders: () => Promise<StudySetFolder[]>;
  createFolder: (title: string) => Promise<StudySetFolder>;
  removeFolder: (folderId: string) => Promise<void>;
}

let inflight: Promise<StudySet[]> | null = null;

/** Test hook: drop the in-flight list so the next `loadSets` actually runs. */
export function __resetStudySetInflightForTests(): void {
  inflight = null;
}

export const useStudySetStore = create<StudySetState>((set, get) => ({
  sets: [],
  folders: [],
  loaded: false,
  loading: false,
  loadError: null,
  lastOpenedId: readLastOpenedId(),
  picker: false,

  loadSets: async (options) => {
    if (get().loaded && !options?.force) return get().sets;
    if (inflight) return inflight;

    // Paint the last good list before the network answers, so a 429 or a
    // dropped proxy does not leave Study on the first-paint skeleton forever.
    if (!get().loaded && get().sets.length === 0) {
      const cached = readCache();
      if (cached && cached.sets.length > 0) {
        set({ sets: cached.sets });
      }
    }

    set({ loading: true, loadError: null });
    inflight = fetchMyStudySets()
      .then((rows) => {
        const sets = Array.isArray(rows) ? rows : [];
        set({ sets, loaded: true, loading: false, loadError: null });
        writeCache(sets);
        return sets;
      })
      .catch((error: unknown) => {
        set({ loading: false, loadError: loadErrorMessage(error) });
        throw error;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  },

  createSet: async (input) => {
    const created = await apiCreate(input);
    const sets = [created, ...get().sets.filter((row) => row.id !== created.id)];
    set({ sets, loaded: true, loadError: null });
    writeCache(sets);
    get().touchOpened(created.id);
    return created;
  },

  updateSet: async (setId, patch) => {
    const updated = await apiUpdate(setId, patch);
    const sets = get().sets.map((row) => (row.id === setId ? updated : row));
    set({ sets });
    writeCache(sets);
    return updated;
  },

  removeSet: async (setId) => {
    await apiDelete(setId);
    const sets = get().sets.filter((row) => row.id !== setId);
    set({ sets });
    writeCache(sets);
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
    void apiTouch(id)
      .then((updated) => {
        set({ sets: get().sets.map((row) => (row.id === updated.id ? updated : row)) });
      })
      .catch(() => undefined);
  },

  openPicker: () => set({ picker: true }),
  closePicker: () => set({ picker: false }),

  loadFolders: async () => {
    const rows = await fetchStudySetFolders().catch(() => []);
    const folders = Array.isArray(rows) ? (rows as StudySetFolder[]) : [];
    set({ folders });
    return folders;
  },

  createFolder: async (title) => {
    const created = (await apiCreateFolder({ title })) as StudySetFolder;
    set({ folders: [created, ...get().folders.filter((row) => row.id !== created.id)] });
    return created;
  },

  removeFolder: async (folderId) => {
    await apiDeleteFolder(folderId);
    set({
      folders: get().folders.filter((row) => row.id !== folderId),
      sets: get().sets.map((row) => (row.folderId === folderId ? { ...row, folderId: null } : row)),
    });
  },
}));
