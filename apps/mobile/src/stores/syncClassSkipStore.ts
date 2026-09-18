/**
 * Which sets have had "Sync with your class" skipped, on this phone.
 *
 * The phone's copy of `useUIStore.syncClassSkipped` on web, with the same
 * shape and the same rule: keyed by user id so signing in as somebody else
 * cannot hide their card, and set-keyed because the answer genuinely differs
 * per set — a student may have a syllabus for one course and none for the next.
 *
 * PERSISTED, unlike `setRoomUiStore` beside it. That store is deliberately
 * session-only because it remembers "the trip I am on"; this remembers a
 * DECISION ("I do not have a syllabus for this set"), and a decision that
 * forgets itself on the next launch is the card coming back every single
 * morning. AsyncStorage is written fire-and-forget: the flag is already true
 * in memory, the card is already gone, and there is nothing a student could do
 * about a failed write.
 *
 * Deliberately NOT synced to the account. The web flag rides in user settings
 * and this one does not, which means skipping on the phone does not skip on
 * the laptop. That is a known gap rather than an oversight: syncing it needs a
 * settings category with arbitrary set-id keys, `featureTips.dismissed` is
 * wiped on every normalize by design ("session-only"), and adding one is a
 * settings-schema change this lane should not make on its way past. The cost
 * of the gap is one extra "Skip for now" tap per device.
 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PREFIX = 'lantern.syncClassSkipped.';

function storageKey(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

interface SyncClassSkipStore {
  /** userId → setId → true. */
  skipped: Record<string, Record<string, boolean>>;
  /** Which users' flags have been read off disk, so a load runs once. */
  hydrated: Record<string, boolean>;
  hydrate: (userId: string | null | undefined) => Promise<void>;
  isSkipped: (userId: string | null | undefined, setId: string | null | undefined) => boolean;
  markSkipped: (userId: string | null | undefined, setId: string | null | undefined) => void;
}

export const useSyncClassSkipStore = create<SyncClassSkipStore>((set, get) => ({
  skipped: {},
  hydrated: {},
  hydrate: async (userId) => {
    if (!userId || get().hydrated[userId]) return;
    // Marked hydrated BEFORE the await: two screens mounting in the same tick
    // would otherwise both read, and the second read would land after the
    // first and could clobber a skip made in between.
    set((state) => ({ hydrated: { ...state.hydrated, [userId]: true } }));
    try {
      const raw = await AsyncStorage.getItem(storageKey(userId));
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      const stored = parsed as Record<string, unknown>;
      // OR in, never replace: a skip made while the read was in flight has to
      // survive it.
      set((state) => {
        const merged = { ...(state.skipped[userId] ?? {}) };
        for (const [setId, value] of Object.entries(stored)) {
          if (value === true) merged[setId] = true;
        }
        return { skipped: { ...state.skipped, [userId]: merged } };
      });
    } catch {
      // A corrupt or unreadable cache means the card shows once more. That is
      // the harmless direction to fail in.
    }
  },
  isSkipped: (userId, setId) => {
    if (!userId || !setId) return false;
    return Boolean(get().skipped[userId]?.[setId]);
  },
  markSkipped: (userId, setId) => {
    if (!userId || !setId) return;
    if (get().skipped[userId]?.[setId]) return;
    const next = { ...(get().skipped[userId] ?? {}), [setId]: true };
    set((state) => ({ skipped: { ...state.skipped, [userId]: next } }));
    void AsyncStorage.setItem(storageKey(userId), JSON.stringify(next)).catch(() => undefined);
  },
}));
