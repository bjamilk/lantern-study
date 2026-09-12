import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { StudySet } from '@lantern/shared/types';
import {
  createStudySet as apiCreate,
  deleteStudySet as apiDelete,
  fetchMyStudySets,
  updateStudySet as apiUpdate,
} from '../services/academic';
import { useAuthStore } from './authStore';

const LAST_OPENED_KEY = 'lantern.lastStudySetId';

/**
 * The last list the server actually returned, per account.
 *
 * Scoped by user id on purpose: a read cache that outlives a sign-out would
 * show one student the other's set titles on the next cold start.
 */
export function studySetCacheKey(userId: string): string {
  return `lantern.studySets.cache:${userId}`;
}

interface CachedStudySets {
  sets: StudySet[];
  syncedAt: string;
}

/**
 * What Home knows about the list, which is NOT the same question as "how many
 * sets are there".
 *
 * The empty-library card used to render whenever `sets.length === 0`, so a
 * cold start with no network — where the fetch had failed and nothing was
 * cached — told a student with four sets that their library was empty and
 * invited them to start it. Only `ready` means "the server answered"; the
 * other three mean "we have not been told", and the card must say so.
 */
export type StudySetStatus = 'loading' | 'ready' | 'offline' | 'error';

/**
 * A transport failure, as opposed to the server answering with a refusal.
 *
 * Offline is the state a pull-to-refresh can fix by itself, so it is worth
 * separating from a real error: the card offers "reconnect and it comes back",
 * not "something went wrong".
 */
export function looksOffline(error: unknown): boolean {
  const message = String((error as { message?: unknown } | null)?.message ?? error ?? '')
    .toLowerCase();
  if (!message) return true;
  return (
    message.includes('network') ||
    message.includes('offline') ||
    message.includes('failed to fetch') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('connection') ||
    message.includes('unreachable')
  );
}

interface StudySetState {
  sets: StudySet[];
  loaded: boolean;
  status: StudySetStatus;
  /** True while `sets` came from the cache rather than this session's server answer. */
  fromCache: boolean;
  /** ISO time of the last successful list, from cache or this session. */
  syncedAt: string | null;
  lastOpenedId: string | null;
  picker: boolean;
  loadSets: (options?: { force?: boolean }) => Promise<StudySet[]>;
  /** Connectivity came back: refetch, but only if we are not already current. */
  notifyReconnected: () => Promise<void>;
  createSet: (input: { title: string; courseId?: string | null }) => Promise<StudySet>;
  updateSet: (
    setId: string,
    patch: { title?: string; courseId?: string | null; examDate?: string | null }
  ) => Promise<StudySet>;
  removeSet: (setId: string) => Promise<void>;
  resolveSet: (setId: string | null | undefined) => StudySet | null;
  touchOpened: (setId: string) => void;
  openPicker: () => void;
  closePicker: () => void;
}

function currentUserId(): string | null {
  try {
    return useAuthStore.getState().user?.id ?? null;
  } catch {
    return null;
  }
}

async function readCache(): Promise<CachedStudySets | null> {
  const userId = currentUserId();
  if (!userId) return null;
  try {
    const raw = await AsyncStorage.getItem(studySetCacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedStudySets> | null;
    if (!parsed || !Array.isArray(parsed.sets)) return null;
    return { sets: parsed.sets as StudySet[], syncedAt: String(parsed.syncedAt ?? '') };
  } catch {
    return null;
  }
}

function writeCache(sets: StudySet[], syncedAt: string): void {
  const userId = currentUserId();
  if (!userId) return;
  void AsyncStorage.setItem(
    studySetCacheKey(userId),
    JSON.stringify({ sets, syncedAt } satisfies CachedStudySets)
  ).catch(() => undefined);
}

let inflight: Promise<StudySet[]> | null = null;

export const useStudySetStore = create<StudySetState>((set, get) => ({
  sets: [],
  loaded: false,
  status: 'loading' as StudySetStatus,
  fromCache: false,
  syncedAt: null as string | null,
  lastOpenedId: null as string | null,
  picker: false,

  loadSets: async (options) => {
    if (get().loaded && !options?.force) return get().sets;
    if (inflight) return inflight;

    const run = async (): Promise<StudySet[]> => {
      set({ status: 'loading' });

      // Cold start: put the cached list on screen BEFORE the fetch resolves,
      // so an offline boot shows the student's real sets instead of a blank
      // card that then turns into the empty-library invitation.
      if (!get().loaded && get().sets.length === 0) {
        const cached = await readCache();
        if (cached && cached.sets.length > 0 && get().sets.length === 0) {
          set({ sets: cached.sets, fromCache: true, syncedAt: cached.syncedAt || null });
        }
      }

      const stored = await AsyncStorage.getItem(LAST_OPENED_KEY).catch(() => null);
      if (stored && !get().lastOpenedId) set({ lastOpenedId: stored });

      try {
        const rows = await fetchMyStudySets();
        const sets = Array.isArray(rows) ? rows : [];
        const syncedAt = new Date().toISOString();
        // `ready` with zero sets is the ONE state that earns the empty-library
        // card: the server answered, and the answer was "none".
        set({ sets, loaded: true, status: 'ready', fromCache: false, syncedAt });
        writeCache(sets, syncedAt);
        return sets;
      } catch (error) {
        // A failed refresh never blanks the list. Whatever we are holding —
        // cache from this boot, or a list fetched earlier this session — stays
        // on screen, labelled for what it is.
        set({
          status: looksOffline(error) ? 'offline' : 'error',
          fromCache: get().sets.length > 0,
        });
        return get().sets;
      }
    };

    inflight = run().finally(() => {
      inflight = null;
    });
    return inflight;
  },

  notifyReconnected: async () => {
    // Already holding a server answer from this session? Nothing to recover.
    if (get().status === 'ready' && !get().fromCache) return;
    await get()
      .loadSets({ force: true })
      .then(() => undefined)
      .catch(() => undefined);
  },

  createSet: async (input) => {
    const created = await apiCreate(input);
    const sets = [created, ...get().sets.filter((row) => row.id !== created.id)];
    set({
      sets,
      loaded: true,
      status: 'ready',
      fromCache: false,
      lastOpenedId: created.id,
      picker: false,
    });
    writeCache(sets, new Date().toISOString());
    return created;
  },

  updateSet: async (setId, patch) => {
    const updated = await apiUpdate(setId, patch);
    const sets = get().sets.map((row) => (row.id === setId ? updated : row));
    set({ sets });
    writeCache(sets, new Date().toISOString());
    return updated;
  },

  removeSet: async (setId) => {
    await apiDelete(setId);
    const sets = get().sets.filter((row) => row.id !== setId);
    set({ sets });
    writeCache(sets, new Date().toISOString());
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

/** Test seam: forget the in-flight load between cases. */
export function __resetStudySetInflightForTests(): void {
  inflight = null;
}
