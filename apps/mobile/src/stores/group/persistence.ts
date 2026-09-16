// ===========================================
// Lantern Study Mobile - Group store: persistence
// ===========================================
//
// Purpose: the chat cache on disk. Two AsyncStorage blobs — `lantern_groups`
// (the chat list) and `lantern_messages` (the whole per-group message cache,
// serialised as one value) — plus the F8 bound that stops either of them
// growing for the lifetime of the process.
//
// Touches: AsyncStorage only. No API calls, no zustand, no mapping — the store
// actions in `state.ts` keep the merge rules and the error handling, so what
// lives here is the raw read/write and the pure eviction policy.
//
// Gotchas:
// - The key STRINGS are a compatibility surface: rename one and every
//   student's cached chat list is orphaned on their next launch. They are
//   pinned by `stores/groupStore.surface.test.ts`.
// - `boundMessagesCache` returns the SAME object when nothing needs dropping,
//   so callers can use it as a no-op guard — `saveToStorage` relies on that to
//   avoid a pointless setState on every send.
// - Recency is process-local and deliberately NOT persisted: it names
//   conversations, and a sign-out must be able to forget all of them
//   (`clearMessagesCacheRecency`, called from the userScoped sweep).
//
// Moved verbatim out of `stores/groupStore.ts` (lane M2), comments included.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Message } from './types';

// Storage keys
const GROUPS_STORAGE_KEY = 'lantern_groups';
const MESSAGES_STORAGE_KEY = 'lantern_messages';

/**
 * Read both chat blobs in one pass. Returns the raw JSON strings (or null):
 * parsing and merging are the store's job, because what wins depends on what
 * is already in memory.
 *
 * @internal
 */
export async function readChatBlobs(): Promise<[string | null, string | null]> {
  return Promise.all([
    AsyncStorage.getItem(GROUPS_STORAGE_KEY),
    AsyncStorage.getItem(MESSAGES_STORAGE_KEY),
  ]);
}

/**
 * Write both chat blobs. The caller passes an ALREADY bounded cache — the blob
 * and the in-memory cache are the same data, so bounding only the write would
 * leave the process growing anyway.
 *
 * @internal
 */
export async function writeChatBlobs(
  groups: unknown,
  boundedMessagesCache: Record<string, Message[]>
): Promise<void> {
  await Promise.all([
    AsyncStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(groups)),
    AsyncStorage.setItem(MESSAGES_STORAGE_KEY, JSON.stringify(boundedMessagesCache)),
  ]);
}

// ---------------------------------------------------------------------------
// FIXED (F8): bounding the message cache
// ---------------------------------------------------------------------------

/** Conversations kept in the cache. Beyond this, the least recently used go. */
export const MESSAGES_CACHE_MAX_CONVERSATIONS = 30;
/** Messages kept per conversation. The NEWEST are the ones kept. */
export const MESSAGES_CACHE_MAX_PER_CONVERSATION = 200;

/**
 * Which conversations were touched most recently, newest tick first.
 *
 * Recency is what "least recently used" needs and no message carries it: a
 * thread opened today may hold a month-old last message. Every read/write path
 * that means "the student is in this conversation" stamps a tick here; a
 * conversation with no tick (restored from disk, never opened this launch)
 * falls back to the time of its newest message.
 */
const messagesCacheRecency = new Map<string, number>();
let messagesCacheTick = 0;

/** Forget all recency. Used by the sign-out sweep below. */
export const clearMessagesCacheRecency = (): void => {
  messagesCacheRecency.clear();
  messagesCacheTick = 0;
};

/** Mark a conversation as just used. Cheap enough to call on every touch. */
export const touchMessagesCache = (conversationId?: string | null): void => {
  if (conversationId) messagesCacheRecency.set(conversationId, ++messagesCacheTick);
};

const newestMessageTime = (list: Message[]): number => {
  let newest = 0;
  for (const m of list) {
    const t = Date.parse(m?.createdAt ?? '');
    if (Number.isFinite(t) && t > newest) newest = t;
  }
  return newest;
};

/** A message that has not reached the server yet is never evicted. */
const isUndelivered = (m: Message): boolean =>
  m?.deliveryState === 'pending' || m?.deliveryState === 'failed';

/** Newest `max` messages, plus every undelivered row whatever its age. */
const trimConversation = (list: Message[], max: number): Message[] => {
  if (list.length <= max) return list;
  const byTime = [...list].sort(
    (a, b) => (Date.parse(a?.createdAt ?? '') || 0) - (Date.parse(b?.createdAt ?? '') || 0)
  );
  const keep = new Set(byTime.slice(-max));
  for (const m of list) if (isUndelivered(m)) keep.add(m);
  // Preserve the caller's ordering — the thread renders straight from this.
  return list.filter((m) => keep.has(m));
};

/**
 * Bound the cache: at most N conversations, at most M messages in each.
 *
 * It used to be unbounded — every fetch, realtime event and page added rows
 * and nothing ever evicted — so a long-lived process grew without limit and
 * `saveToStorage` serialised the whole thing to one AsyncStorage blob on every
 * send. `pinned` (the open thread, the open DM, the selected group) is kept
 * regardless of recency: evicting what is on screen would blank it.
 *
 * Pure, and returns the SAME object when nothing needs dropping, so callers
 * can use it as a no-op guard.
 */
export const boundMessagesCache = (
  cache: Record<string, Message[]>,
  pinned: (string | null | undefined)[] = [],
  limits: { maxConversations?: number; maxPerConversation?: number } = {}
): Record<string, Message[]> => {
  const maxConversations = limits.maxConversations ?? MESSAGES_CACHE_MAX_CONVERSATIONS;
  const maxPer = limits.maxPerConversation ?? MESSAGES_CACHE_MAX_PER_CONVERSATION;
  const keepIds = new Set(pinned.filter((id): id is string => !!id && id in cache));

  const ids = Object.keys(cache);
  if (ids.length > maxConversations) {
    const ranked = ids
      .filter((id) => !keepIds.has(id))
      .sort(
        (a, b) =>
          (messagesCacheRecency.get(b) ?? 0) - (messagesCacheRecency.get(a) ?? 0) ||
          newestMessageTime(cache[b] || []) - newestMessageTime(cache[a] || [])
      );
    for (const id of ranked) {
      if (keepIds.size >= maxConversations) break;
      keepIds.add(id);
    }
  } else {
    ids.forEach((id) => keepIds.add(id));
  }

  let changed = keepIds.size !== ids.length;
  const next: Record<string, Message[]> = {};
  for (const id of ids) {
    if (!keepIds.has(id)) continue;
    const list = cache[id] || [];
    const trimmed = trimConversation(list, maxPer);
    if (trimmed !== list) changed = true;
    next[id] = trimmed;
  }
  if (!changed) return cache;
  // Nothing may be remembered about a conversation that is no longer cached.
  for (const id of messagesCacheRecency.keys()) {
    if (!keepIds.has(id)) messagesCacheRecency.delete(id);
  }
  return next;
};
