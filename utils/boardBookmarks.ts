/**
 * The device-local "Save for me", and its one-way trip to the account.
 *
 * Web wrote `lantern:board:saved:{userId}` — one flat set for every board.
 * Mobile wrote AsyncStorage `lantern_starred_msgs:{userId}:{groupId}` — one
 * set per board. The two could not read each other even in principle, both
 * died on reinstall, and neither platform had a screen that listed what you
 * had saved. `message_bookmarks` replaces both; this module is what carries
 * the existing saves across, once, and then gets out of the way.
 *
 * Kept pure and storage-injectable so the import rules are testable without a
 * browser: the rule that matters is that the local key is deleted ONLY after a
 * server-backed 2xx, so a 503 from a database without the migration leaves the
 * student's saves exactly where they were.
 */
import { BOARD_BOOKMARK_IMPORT_MAX } from '@lantern/shared/network';

export const SAVED_POSTS_KEY = 'lantern:board:saved';

/** Just enough of `Storage` to be faked in a test. */
export interface KeyValueStore {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

function browserStore(): KeyValueStore | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    // Embedded webviews can throw on the accessor itself.
    return null;
  }
}

export function savedPostsKey(userId: string): string {
  return `${SAVED_POSTS_KEY}:${userId}`;
}

export function readSavedPosts(userId: string, store: KeyValueStore | null = browserStore()): Set<string> {
  if (!store || !userId) return new Set();
  try {
    const raw = store.getItem(savedPostsKey(userId));
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(list) ? list.map(String).filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

export function writeSavedPosts(
  userId: string,
  ids: Set<string>,
  store: KeyValueStore | null = browserStore(),
): void {
  if (!store || !userId) return;
  try {
    store.setItem(savedPostsKey(userId), JSON.stringify([...ids]));
  } catch {
    // A personal bookmark is best-effort; a full quota must not break posting.
  }
}

export function clearSavedPosts(userId: string, store: KeyValueStore | null = browserStore()): void {
  if (!store || !userId) return;
  try {
    store.removeItem(savedPostsKey(userId));
  } catch {
    // Nothing to do: the next import is idempotent server-side.
  }
}

/**
 * The ids this device would send. Capped at the server's own limit so an
 * oversized set is trimmed here rather than rejected wholesale — sending 201
 * ids currently 400s and imports nothing at all.
 *
 * Web's key is board-only by construction (only `BoardPostCard` ever wrote to
 * it), which is why there is no "is this a board?" filter here. Mobile needs
 * one, because its key shape is shared with chat and DM stars.
 */
export function bookmarkImportPayload(
  ids: Iterable<string>,
  max: number = BOARD_BOOKMARK_IMPORT_MAX,
): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = typeof raw === 'string' ? raw.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
    if (unique.length >= max) break;
  }
  return unique;
}

/**
 * Has this account's local set already been handed over? Tracked per user, so
 * two accounts on one laptop each get their own import.
 */
export function bookmarkImportDoneKey(userId: string): string {
  return `${SAVED_POSTS_KEY}:imported:${userId}`;
}

export function hasImportedBookmarks(
  userId: string,
  store: KeyValueStore | null = browserStore(),
): boolean {
  if (!store || !userId) return true;
  try {
    return store.getItem(bookmarkImportDoneKey(userId)) === '1';
  } catch {
    return true;
  }
}

export function markBookmarksImported(
  userId: string,
  store: KeyValueStore | null = browserStore(),
): void {
  if (!store || !userId) return;
  try {
    store.setItem(bookmarkImportDoneKey(userId), '1');
  } catch {
    // Worst case the import runs again, which the server makes harmless.
  }
}
