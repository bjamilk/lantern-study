/**
 * The device-local save, and the one-way trip to the account.
 *
 * The rule these tests exist to protect: the local key is deleted only after a
 * server-backed 2xx. The API deploys before the founder hand-applies the
 * migration, so "import then clear" running against a database with no
 * `message_bookmarks` would throw away every save a student had.
 */
import { describe, expect, it } from 'vitest';
import { BOARD_BOOKMARK_IMPORT_MAX } from '@lantern/shared/network';
import {
  bookmarkImportPayload,
  clearSavedPosts,
  hasImportedBookmarks,
  markBookmarksImported,
  readSavedPosts,
  savedPostsKey,
  writeSavedPosts,
  type KeyValueStore,
} from './boardBookmarks';

function fakeStore(seed: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key)! : null),
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const throwingStore: KeyValueStore = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('SecurityError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

describe('local saved posts', () => {
  it('reads and writes one flat set per account', () => {
    const store = fakeStore();
    writeSavedPosts('u1', new Set(['a', 'b']), store);
    expect(store.data.get(savedPostsKey('u1'))).toBe('["a","b"]');
    expect([...readSavedPosts('u1', store)]).toEqual(['a', 'b']);
    // Another account on the same laptop has its own set.
    expect(readSavedPosts('u2', store).size).toBe(0);
  });

  it('reads an empty set from junk rather than throwing', () => {
    const store = fakeStore({ [savedPostsKey('u1')]: '{not json' });
    expect(readSavedPosts('u1', store).size).toBe(0);
    const notAList = fakeStore({ [savedPostsKey('u1')]: '{"a":1}' });
    expect(readSavedPosts('u1', notAList).size).toBe(0);
  });

  it('survives a storage accessor that throws, as embedded webviews do', () => {
    expect(readSavedPosts('u1', throwingStore).size).toBe(0);
    expect(() => writeSavedPosts('u1', new Set(['a']), throwingStore)).not.toThrow();
    expect(() => clearSavedPosts('u1', throwingStore)).not.toThrow();
    expect(() => markBookmarksImported('u1', throwingStore)).not.toThrow();
    // Unreadable storage must not re-run an import forever.
    expect(hasImportedBookmarks('u1', throwingStore)).toBe(true);
  });

  it('clears only the saves, and only for that account', () => {
    const store = fakeStore();
    writeSavedPosts('u1', new Set(['a']), store);
    writeSavedPosts('u2', new Set(['b']), store);
    clearSavedPosts('u1', store);
    expect(readSavedPosts('u1', store).size).toBe(0);
    expect([...readSavedPosts('u2', store)]).toEqual(['b']);
  });
});

describe('the one-time import', () => {
  it('is not marked done until it is marked done', () => {
    const store = fakeStore();
    expect(hasImportedBookmarks('u1', store)).toBe(false);
    markBookmarksImported('u1', store);
    expect(hasImportedBookmarks('u1', store)).toBe(true);
    // Per account, so a second student on the same laptop still imports.
    expect(hasImportedBookmarks('u2', store)).toBe(false);
  });

  it('sends unique, non-empty ids', () => {
    expect(bookmarkImportPayload(['a', 'a', '', '  ', ' b '])).toEqual(['a', 'b']);
  });

  it('trims to the server cap instead of being rejected wholesale', () => {
    const many = Array.from({ length: BOARD_BOOKMARK_IMPORT_MAX + 25 }, (_, i) => `m${i}`);
    const payload = bookmarkImportPayload(many);
    expect(payload).toHaveLength(BOARD_BOOKMARK_IMPORT_MAX);
    expect(payload[0]).toBe('m0');
  });

  it('takes a Set straight from the local store', () => {
    const store = fakeStore();
    writeSavedPosts('u1', new Set(['x', 'y']), store);
    expect(bookmarkImportPayload(readSavedPosts('u1', store))).toEqual(['x', 'y']);
  });
});
