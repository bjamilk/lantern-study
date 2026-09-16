/**
 * The store-slice types the `hooks/groups/*` handler hooks take as parameters.
 *
 * Exports: `AuthStoreState` / `GroupStoreState` / `UIStoreState` — the exact
 *  state shapes of the three stores `useGroupHandlers` reads, so each hook can
 *  declare `Pick<…>` of what it actually uses and nothing more; plus the two
 *  cross-hook callback types (`AddNotification`, `HandleSelectChat`) the
 *  composer passes down.
 * Touches: nothing at runtime — every import here is `import type`, so this
 *  module compiles away entirely.
 * Gotcha: the state types come from `typeof useX.getState`, NOT from
 *  `typeof useX`. A zustand bound store is an overloaded callable
 *  (`(): S` and `<U>(selector) => U`), and `ReturnType` resolves overloads to
 *  the LAST signature — which would silently give `unknown` here.
 */
import type { useAuthStore } from '../../stores/authStore';
import type { useGroupStore } from '../../stores/groupStore';
import type { useUIStore } from '../../stores/uiStore';
import type { ChatItem } from '../../types';

export type AuthStoreState = ReturnType<typeof useAuthStore.getState>;
export type GroupStoreState = ReturnType<typeof useGroupStore.getState>;
export type UIStoreState = ReturnType<typeof useUIStore.getState>;

/**
 * `addNotification` from the composer: creates an untyped notification for the
 * current user and appends it locally. Never rejects — a notification that
 * could not be written must not fail the action that triggered it.
 */
export type AddNotification = (message: string) => Promise<void>;

/** `handleSelectChat` from the composer — the one chat-selection path. */
export type HandleSelectChat = (chat: ChatItem, options?: { keepSurface?: boolean }) => void;
