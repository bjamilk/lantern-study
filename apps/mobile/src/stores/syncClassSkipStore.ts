/**
 * Which sets have had "Sync with your class" skipped.
 *
 * The decision lives on the ACCOUNT, in `settings.syncClassSkipped` — the same
 * key the browser writes — so skipping on the phone skips on the laptop too.
 * This store is the phone's offline CACHE of that key plus the write-through:
 * the flag is true in memory and the card is gone before either write is even
 * attempted, and a student on a campus link with no signal must not be asked
 * again on the next launch because a request failed.
 *
 * Exports: `useSyncClassSkipStore` (`skipped`, `hydrated`, `hydrate`,
 * `isSkipped`, `markSkipped`).
 * Touches: AsyncStorage (`lantern.syncClassSkipped.<userId>`) for the cache and
 * `settingsStore.updateSettings('syncClassSkipped', …)` for the account, which
 * queues the patch and flushes it with every other settings write.
 *
 * It is keyed by user id as well as by set: signing in as somebody else on a
 * shared phone must not hide their card. Set-keyed because the answer genuinely
 * differs per set — a student may have a syllabus for one course and none for
 * the next.
 *
 * PERSISTED, unlike `setRoomUiStore` beside it. That store is deliberately
 * session-only because it remembers "the trip I am on"; this remembers a
 * DECISION ("I do not have a syllabus for this set"), and a decision that
 * forgets itself on the next launch is the card coming back every morning.
 *
 * Gotchas:
 *  - MONOTONIC. Nothing here un-skips a set, and the patch only ever carries
 *    ids that ARE skipped, so a queued write replayed late cannot un-hide a
 *    card the student has since seen hidden.
 *  - The account map is BOUNDED (`SYNC_CLASS_SKIPPED_CAP`, oldest dropped).
 *    The device cache is not pruned with it and `hydrate` pushes back anything
 *    the account is missing, so this phone keeps knowing what the account has
 *    forgotten.
 *  - Both writes are fire-and-forget. The flag is already true in memory, the
 *    card is already gone, and there is nothing a student could do about a
 *    failed write.
 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeSyncClassSkipped } from '@lantern/shared/settings';
import { useSettingsStore } from './settingsStore';

const KEY_PREFIX = 'lantern.syncClassSkipped.';

function storageKey(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

/**
 * The account's skipped set ids, or nothing when the cached settings belong to
 * a different account (a sign-in whose load has not landed yet).
 */
function accountSkips(userId: string): Record<string, number> {
  const state = useSettingsStore.getState();
  if (state.ownerUserId && state.ownerUserId !== userId) return {};
  return normalizeSyncClassSkipped(state.settings.syncClassSkipped);
}

/** Queue a `syncClassSkipped` patch. The settings store owns the flush. */
function pushToAccount(setIds: string[], at: number): void {
  if (setIds.length === 0) return;
  const patch: Record<string, number> = {};
  for (const setId of setIds) patch[setId] = at;
  void useSettingsStore
    .getState()
    .updateSettings('syncClassSkipped', patch)
    .catch(() => undefined);
}

interface SyncClassSkipStore {
  /** userId → setId → true. The offline cache of the account's map. */
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

    // The account first, off the settings the app already has in memory — it
    // needs no await and no network, and it is the half that came from another
    // device.
    const remote = accountSkips(userId);

    let stored: Record<string, unknown> = {};
    try {
      const raw = await AsyncStorage.getItem(storageKey(userId));
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        stored = parsed as Record<string, unknown>;
      }
    } catch {
      // A corrupt or unreadable cache means the card shows once more for the
      // sets only this phone knew about. That is the harmless direction.
    }

    // OR in, never replace: a skip made while the read was in flight has to
    // survive it.
    set((state) => {
      const merged = { ...(state.skipped[userId] ?? {}) };
      for (const setId of Object.keys(remote)) merged[setId] = true;
      for (const [setId, value] of Object.entries(stored)) {
        if (value === true) merged[setId] = true;
      }
      return { skipped: { ...state.skipped, [userId]: merged } };
    });

    const mine = get().skipped[userId] ?? {};
    // Self-heal: a skip this phone made offline, or before this shipped, or one
    // the account's cap dropped, is pushed back up. Without it the first write
    // that failed would be lost for good.
    const missingOnAccount = Object.keys(mine).filter((setId) => remote[setId] === undefined);
    if (missingOnAccount.length > 0) {
      pushToAccount(missingOnAccount, Date.now());
      void AsyncStorage.setItem(storageKey(userId), JSON.stringify(mine)).catch(() => undefined);
    }
  },
  isSkipped: (userId, setId) => {
    if (!userId || !setId) return false;
    if (get().skipped[userId]?.[setId]) return true;
    // The account map is consulted directly as well as through the cache, so a
    // settings load that lands AFTER `hydrate` still hides the card.
    return accountSkips(userId)[setId] !== undefined;
  },
  markSkipped: (userId, setId) => {
    if (!userId || !setId) return;
    if (get().skipped[userId]?.[setId]) return;
    const next = { ...(get().skipped[userId] ?? {}), [setId]: true };
    set((state) => ({ skipped: { ...state.skipped, [userId]: next } }));
    void AsyncStorage.setItem(storageKey(userId), JSON.stringify(next)).catch(() => undefined);
    pushToAccount([setId], Date.now());
  },
}));
