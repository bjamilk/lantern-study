import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { StudySet, StudySetFolder } from '@lantern/shared/types';
import type { StudySetTopic, StudySetTopicStatus, StudySetUnit } from '@lantern/shared/learning';
import {
  createStudySet as apiCreate,
  deleteStudySet as apiDelete,
  fetchMyStudySets,
  updateStudySet as apiUpdate,
  touchStudySet as apiTouch,
  fetchStudySetPlan,
  replaceStudySetPlan,
  updateStudySetTopicStatus,
  fetchStudySetFolders,
  createStudySetFolder as apiCreateFolder,
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

/**
 * One set's plan as the SERVER holds it.
 *
 * The phone used to rebuild this from note titles on every render, which is
 * why a topic marked covered on a laptop came back unmarked here: there was
 * nothing to come back from. `loaded` distinguishes "the server said this set
 * has no plan yet" from "we have not asked" — the first earns the build-a-plan
 * invitation, the second must fall back to the derived topics in silence.
 */
export interface StudySetPlan {
  units: StudySetUnit[];
  topics: StudySetTopic[];
  loaded: boolean;
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
  /** Plans by set id, as the server holds them. */
  plans: Record<string, StudySetPlan>;
  folders: StudySetFolder[];
  createSet: (input: { title: string; courseId?: string | null }) => Promise<StudySet>;
  updateSet: (
    setId: string,
    patch: {
      title?: string;
      courseId?: string | null;
      examDate?: string | null;
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
  /**
   * Record a cover the cover ROUTE already stored (or cleared with null).
   *
   * Local only: the upload is its own request, so re-sending the path through
   * PATCH would be a second write of a value the server set itself — and the
   * PATCH refuses a non-null `coverPath` anyway, exactly so a client cannot
   * aim the column at an object it does not own.
   */
  setCoverPath: (setId: string, coverPath: string | null) => void;
  resolveSet: (setId: string | null | undefined) => StudySet | null;
  touchOpened: (setId: string) => void;
  /** Tell the server the set was opened, so "last studied" is true on every device. */
  touchSet: (setId: string) => Promise<void>;
  loadPlan: (setId: string) => Promise<StudySetPlan>;
  savePlan: (
    setId: string,
    input: {
      units: Array<{ title: string; position: number }>;
      topics: Array<{
        unitIndex: number;
        title: string;
        position: number;
        status: StudySetTopicStatus;
        sourceNoteIds: string[];
      }>;
    }
  ) => Promise<StudySetPlan>;
  setTopicStatus: (setId: string, topicId: string, status: StudySetTopicStatus) => Promise<void>;
  loadFolders: () => Promise<StudySetFolder[]>;
  createFolder: (title: string) => Promise<StudySetFolder>;
  /**
   * Which folder chip the Study hub is standing on (`ALL_FOLDERS`, or an id).
   *
   * It lives in the store rather than in the screen's `useState` so it survives
   * the hub unmounting: on a tab navigator, walking into a set room and back
   * remounts the screen, and a filter that resets on the way back means every
   * return trip dumps the student back into the full list they had just
   * narrowed. Session-scoped on purpose — not written to AsyncStorage, so a
   * cold start opens on All and nobody is ever confronted by a short list they
   * do not remember asking for.
   */
  folderFilter: string;
  setFolderFilter: (selection: string) => void;
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
  plans: {} as Record<string, StudySetPlan>,
  folders: [] as StudySetFolder[],
  folderFilter: 'all',

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

  setCoverPath: (setId, coverPath) => {
    const sets = get().sets.map((row) => (row.id === setId ? { ...row, coverPath } : row));
    set({ sets });
    // Cached too: without this the cover vanishes on the next cold start and
    // comes back only after the list refetch lands.
    writeCache(sets, new Date().toISOString());
  },

  removeSet: async (setId) => {
    await apiDelete(setId);
    const sets = get().sets.filter((row) => row.id !== setId);
    // Forget the deleted set's plan and, if it was the one being studied, the
    // pointer to it. A `lastOpenedId` left aimed at a deleted set is what makes
    // the next cold start open a room for a set that is not there any more.
    const plans = { ...get().plans };
    delete plans[setId];
    const lastOpenedId = get().lastOpenedId === setId ? null : get().lastOpenedId;
    set({ sets, plans, lastOpenedId });
    if (lastOpenedId === null) {
      void AsyncStorage.removeItem(LAST_OPENED_KEY).catch(() => undefined);
    }
    writeCache(sets, new Date().toISOString());
  },

  resolveSet: (setId) => get().sets.find((row) => row.id === setId) ?? null,

  touchOpened: (setId) => {
    const id = setId.trim();
    if (!id) return;
    set({ lastOpenedId: id, picker: false });
    void AsyncStorage.setItem(LAST_OPENED_KEY, id).catch(() => undefined);
  },

  /**
   * "I am studying this set now."
   *
   * `touchOpened` is the phone's own memory of which set to reopen; this is the
   * server's. Nothing on mobile ever posted it, so a set studied only on the
   * phone showed no "last studied" date anywhere — on the phone, on web, or in
   * the resume feed. Deliberately quiet on failure: a set still opens fine when
   * the stamp does not land, so a lost network must not become an error the
   * student has to dismiss on the way into their own room.
   */
  touchSet: async (setId) => {
    const id = setId.trim();
    if (!id) return;

    // Stamp the local row FIRST, and persist it.
    //
    // Home reads "last studied" off the cached list, and the only thing that
    // ever set it was the server's answer to this call — which arrives after
    // Home has already rendered, may never arrive at all offline, and is lost
    // on the next cold start because the cache was written without it. So a
    // student opened a set, went Home, and saw no study history at all. The
    // optimistic value is also the true one: they are in the room.
    const stampedAt = new Date().toISOString();
    const stamped = get().sets.map((row) =>
      row.id === id ? { ...row, lastStudiedAt: stampedAt } : row
    );
    set({ sets: stamped });
    writeCache(stamped, get().syncedAt ?? stampedAt);

    try {
      const updated = await apiTouch(id);
      const sets = get().sets.map((row) =>
        row.id === id
          ? { ...row, ...(updated ?? {}), lastStudiedAt: updated?.lastStudiedAt ?? row.lastStudiedAt }
          : row
      );
      set({ sets });
      writeCache(sets, get().syncedAt ?? stampedAt);
    } catch {
      // Keep the optimistic stamp: they did open the set, and the next
      // successful list replaces it with the server's own time.
    }
  },

  loadPlan: async (setId) => {
    const empty: StudySetPlan = { units: [], topics: [], loaded: false };
    if (!setId) return empty;
    try {
      const data = (await fetchStudySetPlan(setId)) as {
        units?: StudySetUnit[];
        topics?: StudySetTopic[];
      } | null;
      const plan: StudySetPlan = {
        units: Array.isArray(data?.units) ? data!.units : [],
        topics: Array.isArray(data?.topics) ? data!.topics : [],
        loaded: true,
      };
      set({ plans: { ...get().plans, [setId]: plan } });
      return plan;
    } catch {
      // Unreached, not empty: the room falls back to topics derived from the
      // set's own notes, and must not be told the plan is genuinely empty.
      const kept = get().plans[setId] ?? empty;
      set({ plans: { ...get().plans, [setId]: kept } });
      return kept;
    }
  },

  savePlan: async (setId, input) => {
    const saved = (await replaceStudySetPlan(setId, input)) as {
      units?: StudySetUnit[];
      topics?: StudySetTopic[];
    } | null;
    const plan: StudySetPlan = {
      units: Array.isArray(saved?.units) ? saved!.units : [],
      topics: Array.isArray(saved?.topics) ? saved!.topics : [],
      loaded: true,
    };
    set({ plans: { ...get().plans, [setId]: plan } });
    return plan;
  },

  /**
   * Tick a topic. Optimistic on purpose — the checkbox must move under the
   * thumb — but a refused write is rolled back rather than left showing a
   * state the server never accepted.
   */
  setTopicStatus: async (setId, topicId, status) => {
    const before = get().plans[setId];
    if (!before) return;
    const after: StudySetPlan = {
      ...before,
      topics: before.topics.map((topic) => (topic.id === topicId ? { ...topic, status } : topic)),
    };
    set({ plans: { ...get().plans, [setId]: after } });
    try {
      await updateStudySetTopicStatus(setId, topicId, status);
    } catch (error) {
      set({ plans: { ...get().plans, [setId]: before } });
      throw error;
    }
  },

  loadFolders: async () => {
    try {
      const rows = await fetchStudySetFolders();
      const folders = Array.isArray(rows) ? (rows as StudySetFolder[]) : [];
      set({ folders });
      return folders;
    } catch {
      return get().folders;
    }
  },

  /**
   * Make a folder, exactly as web's store does.
   *
   * Loud on failure — unlike `loadFolders`, which can fall back to what it is
   * already holding, there is nothing to fall back to here: the student typed
   * a name and pressed a button, and a silent catch would leave them looking
   * at a chip row that never grew with no idea why. The screen catches and
   * toasts.
   */
  createFolder: async (title) => {
    const created = (await apiCreateFolder({ title })) as StudySetFolder;
    set({ folders: [created, ...get().folders.filter((row) => row.id !== created.id)] });
    return created;
  },

  setFolderFilter: (selection) => set({ folderFilter: selection || 'all' }),

  openPicker: () => set({ picker: true }),
  closePicker: () => set({ picker: false }),
}));

/** Test seam: forget the in-flight load between cases. */
export function __resetStudySetInflightForTests(): void {
  inflight = null;
}
