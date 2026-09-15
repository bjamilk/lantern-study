/**
 * The registry of user-scoped state — one place that knows everything holding
 * a signed-in student's data, and one call that drops all of it.
 *
 * Two separate problems live here, and they need each other:
 *
 * 1. **In-memory state outlives a sign-out.** A zustand store, a module-level
 *    cache or a subscriber list is not storage: clearing AsyncStorage does
 *    nothing to it. On a shared handset that is how the next account's first
 *    frame was painted with the previous student's chats, credits and quiz.
 *    Each such holder calls `registerUserScoped(name, reset)` once, at module
 *    scope, and the ONE sign-out path in `authStore.signOut` (plus an account
 *    switch, see `setUserScopeId`) calls `resetAllUserScopedState(reason)`.
 *
 * 2. **Persisted keys with no user in them.** A fixed AsyncStorage key holds
 *    whichever account wrote it last. `scopedKey`/`readScopedWithLegacyMigration`
 *    move such a key to `<base>:<userId>` and adopt the pre-split value into
 *    the first account that reads it, so nothing is lost and nothing crosses.
 *
 * The scope id is pushed IN from `authStore` (this module imports no store, so
 * it can be required from anywhere without a cycle) and it is `null` until auth
 * has resolved. Readers that must not paint another account's data wait on
 * `whenUserScopeResolved()` rather than reading a key with no id in it.
 *
 * Resets must be cheap, synchronous-ish and total: drop caches, do not fetch.
 * A reset that throws is logged and skipped so one bad store cannot leave the
 * rest of the handset holding the previous student's data.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type UserScopeResetReason =
  /** The student tapped Sign out. */
  | 'sign-out'
  /** The server ended the session (token revoked, account suspended). */
  | 'session-revoked'
  /** A different account signed in on the same handset without a sign-out. */
  | 'account-switch';

type ResetFn = () => void | Promise<void>;

const registry = new Map<string, ResetFn>();

/**
 * Register a holder of user-scoped state. Call once, at module scope.
 *
 * Re-registering under the same `name` replaces the previous entry (Fast
 * Refresh re-evaluates modules), so a hot reload cannot stack duplicates.
 * Returns an unregister function for tests.
 */
export function registerUserScoped(name: string, reset: ResetFn): () => void {
  registry.set(name, reset);
  return () => {
    if (registry.get(name) === reset) registry.delete(name);
  };
}

/** Names currently registered, in registration order. Diagnostics and tests. */
export function registeredUserScopedNames(): string[] {
  return [...registry.keys()];
}

/**
 * Drop every registered holder's copy of the current account's data.
 *
 * Each reset is awaited independently: one that throws is logged and the sweep
 * continues, because a half-cleared handset is the bug this exists to prevent.
 */
export async function resetAllUserScopedState(
  reason: UserScopeResetReason
): Promise<void> {
  for (const [name, reset] of [...registry.entries()]) {
    try {
      await reset();
    } catch (error) {
      console.warn(`[UserScope] reset failed for "${name}" (${reason}):`, error);
    }
  }
}

// ---------------------------------------------------------------------------
// The current scope id
// ---------------------------------------------------------------------------

let currentUserId: string | null = null;
let resolved = false;
let waiters: ((userId: string | null) => void)[] = [];
const scopeListeners = new Set<(userId: string | null) => void>();

/** The signed-in account's id, or null when signed out / not yet resolved. */
export function getUserScopeId(): string | null {
  return currentUserId;
}

/** Has auth answered at least once this launch? */
export function isUserScopeResolved(): boolean {
  return resolved;
}

/**
 * Resolve once auth has answered — with the user id, or null when signed out.
 *
 * Persisted reads that would otherwise paint before auth resolves await this,
 * so a scoped key is never read under the wrong (or no) account.
 */
export function whenUserScopeResolved(): Promise<string | null> {
  if (resolved) return Promise.resolve(currentUserId);
  return new Promise((resolve) => {
    waiters.push(resolve);
  });
}

/** Notified whenever the scope id changes (sign-in, switch, sign-out). */
export function subscribeToUserScope(
  listener: (userId: string | null) => void
): () => void {
  scopeListeners.add(listener);
  return () => {
    scopeListeners.delete(listener);
  };
}

/**
 * Point the registry at an account. Called from `authStore` only.
 *
 * A change from one non-null id to a DIFFERENT non-null id is an account
 * switch with no sign-out in between (session handover, deep-link sign-in), so
 * it sweeps on its own. The null transitions are left to `signOut`, which has
 * to do its storage work in a particular order.
 */
export async function setUserScopeId(userId: string | null): Promise<void> {
  const previous = currentUserId;
  const firstResolution = !resolved;
  currentUserId = userId;
  resolved = true;

  if (firstResolution) {
    const pending = waiters;
    waiters = [];
    pending.forEach((resolve) => resolve(userId));
  }

  if (previous !== userId) {
    scopeListeners.forEach((listener) => {
      try {
        listener(userId);
      } catch (error) {
        console.warn('[UserScope] scope listener failed:', error);
      }
    });
  }

  if (previous && userId && previous !== userId) {
    await resetAllUserScopedState('account-switch');
  }
}

// ---------------------------------------------------------------------------
// Scoped storage keys
// ---------------------------------------------------------------------------

/** `<base>:<userId>` — the one spelling of a per-account storage key. */
export function scopedKey(base: string, userId: string): string {
  return `${base}:${userId}`;
}

/**
 * Read `userId`'s copy of a key that used to be global, adopting the pre-split
 * value the first time an account asks for it.
 *
 * The adopting account is the first to read after the upgrade — on a single
 * handset that is the only honest guess, and it is the same rule the unsynced
 * work queues use (`stores/pendingResultsScope.ts`). The legacy key is removed
 * either way, so a second account can never inherit it.
 */
export async function readScopedWithLegacyMigration(
  base: string,
  userId: string
): Promise<string | null> {
  const key = scopedKey(base, userId);
  try {
    const scoped = await AsyncStorage.getItem(key);
    if (scoped != null) {
      // Someone else's legacy leftovers must not survive behind a scoped value.
      void AsyncStorage.removeItem(base).catch(() => undefined);
      return scoped;
    }
    const legacy = await AsyncStorage.getItem(base);
    if (legacy == null) return null;
    await AsyncStorage.setItem(key, legacy);
    await AsyncStorage.removeItem(base);
    return legacy;
  } catch {
    return null;
  }
}

/** Test seam: forget every registration and the current scope. */
export function __resetUserScopedStateForTests(): void {
  registry.clear();
  scopeListeners.clear();
  currentUserId = null;
  resolved = false;
  waiters = [];
}
