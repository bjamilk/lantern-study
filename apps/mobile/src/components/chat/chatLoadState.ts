/**
 * What ONE chat thread should render right now, and how it learns whether its
 * own load failed.
 *
 * The bug this exists for: opening a group thread offline rendered "No
 * messages yet. Say hello!" for a conversation whose messages had been on
 * screen minutes earlier. The chat list one level up degraded correctly,
 * because it decides with the shared `resolveListState` rule over its OWN
 * `listError`. The thread decided with two fields it does not own:
 *
 *   - `groupStore.error` is a single store-wide string. `fetchGroups` clears
 *     it at the top of every run (`set({ isLoading: true, error: null, ... })`),
 *     and so does the start of any page-1 `fetchMessages` for ANY group. The
 *     chat list is still mounted under the thread, so its refresh — including
 *     the reconnect one-shot retry — wipes the thread's failure.
 *   - `messagesCache[groupId]` is replaced wholesale by `loadFromStorage()`,
 *     which `fetchGroups` calls on every run.
 *
 * Both land together, so the thread's two inputs became "no error, no
 * messages" at the same instant — which the FlatList renders as the empty
 * state. The screen now keeps its own outcome, decided here.
 *
 * Pure and free of native imports: mobile jest runs `**\/*.test.ts` on the
 * node environment.
 */

import { resolveListState, type RequestListState } from '@lantern/shared/network';

export interface ChatThreadLoadOutcome {
  /** The load did not bring back messages. */
  failed: boolean;
  /** What to say about it, or null when it succeeded. */
  error: string | null;
}

/**
 * Did this thread's load succeed?
 *
 * `groupStore.fetchMessages` swallows its own failure, so the caller cannot
 * learn the answer from a rejected promise, and the store's shared `error`
 * may already have been cleared by an unrelated fetch (see above). The
 * reliable signal is `messagePagination[groupId]`: a successful page-1 load
 * always writes a fresh `{ page, hasMore }` object there, and a failed one
 * writes nothing. Identity, not value — a second successful load of the same
 * page still swaps the object.
 *
 * The store's error is used only for the WORDS, and only when it is still
 * there; the caller renders shared failure copy either way.
 */
export function resolveChatLoadOutcome(input: {
  /** `messagePagination[groupId]` sampled before the load started. */
  paginationBefore: unknown;
  /** The same slot after it finished. */
  paginationAfter: unknown;
  /** `groupStore.error` after it finished — may have been cleared by others. */
  storeError?: string | null;
}): ChatThreadLoadOutcome {
  const succeeded = input.paginationAfter !== undefined
    && input.paginationAfter !== input.paginationBefore;
  if (succeeded) return { failed: false, error: null };
  return {
    failed: true,
    // 'Network request failed' is React Native's own wording for a dead link,
    // and the shared copy module classifies it as `offline` — the right
    // sentence when the store's message has been cleared out from under us.
    error: input.storeError || 'Network request failed',
  };
}

/**
 * The same rule the chat list uses, over the thread's own two facts.
 *
 * `itemCount` is the CACHED message count, not the filtered one: the starred
 * filter showing nothing is not a failed load, and a failed load with cached
 * messages behind a filter is still `stale`, not `failed`.
 */
export function resolveChatMessagesState(input: {
  loading: boolean;
  error: string | null;
  cachedMessageCount: number;
}): RequestListState {
  return resolveListState({
    loading: input.loading,
    error: input.error,
    itemCount: input.cachedMessageCount,
  });
}
