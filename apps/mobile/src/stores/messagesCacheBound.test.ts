/**
 * The message cache is bounded (F8).
 *
 * `messagesCache` used to grow for the lifetime of the process — every fetch,
 * realtime event and page added rows and nothing ever evicted — and the whole
 * thing was serialised to one AsyncStorage blob on every send. These pin the
 * eviction policy: least recently used conversation goes first, the open thread
 * never goes, and nothing the student has written but not yet sent is ever
 * dropped to make room.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
    multiRemove: jest.fn(async () => undefined),
  },
}));
jest.mock('../services/api', () => ({ __esModule: true }));
jest.mock('../services/syncService', () => ({
  __esModule: true,
  syncService: { registerHandler: jest.fn() },
}));
// groupStore constructs this at module scope; the shared-utils test double
// does not carry it and adding it there would be a change to every suite.
jest.mock('@lantern/shared/utils', () => ({
  __esModule: true,
  ...jest.requireActual('@lantern/shared/utils'),
  DeliveryIntentRegistry: class {},
}));
// The bare specifier has no jest mapping (only '@lantern/shared/*' subpaths do).
jest.mock('@lantern/shared', () => ({ __esModule: true, isTransientSyncError: () => false }), {
  virtual: true,
});
jest.mock('expo-crypto', () => ({ __esModule: true, randomUUID: () => 'uuid' }));
jest.mock('./authStore', () => ({
  __esModule: true,
  useAuthStore: { getState: () => ({ user: null }) },
}));

import {
  boundMessagesCache,
  clearMessagesCacheRecency,
  touchMessagesCache,
  type Message,
} from './groupStore';

let seq = 0;
const msg = (over: Partial<Message> = {}): Message =>
  ({
    id: `m${++seq}`,
    groupId: 'g',
    senderId: 'u',
    senderName: 'U',
    text: 'hi',
    type: 'text',
    createdAt: new Date(1_700_000_000_000 + seq * 1000).toISOString(),
    ...over,
  }) as Message;

const cacheOf = (ids: string[], per = 1): Record<string, Message[]> =>
  Object.fromEntries(ids.map((id) => [id, Array.from({ length: per }, () => msg())]));

beforeEach(() => {
  seq = 0;
  clearMessagesCacheRecency();
});

it('evicts the least recently used conversations past the limit', () => {
  const cache = cacheOf(['a', 'b', 'c', 'd']);
  touchMessagesCache('a');
  touchMessagesCache('d');
  touchMessagesCache('b');

  const bounded = boundMessagesCache(cache, [], { maxConversations: 2 });

  // b and d were touched last; a is older and c was never opened at all.
  expect(Object.keys(bounded).sort()).toEqual(['b', 'd']);
});

it('never evicts the conversation on screen, however stale', () => {
  const cache = cacheOf(['open', 'x', 'y']);
  touchMessagesCache('x');
  touchMessagesCache('y');

  const bounded = boundMessagesCache(cache, ['open'], { maxConversations: 1 });

  expect(Object.keys(bounded)).toEqual(['open']);
});

it('falls back to the newest message when a conversation was never touched', () => {
  const cache = {
    old: [msg({ createdAt: '2026-01-01T00:00:00.000Z' })],
    recent: [msg({ createdAt: '2026-09-01T00:00:00.000Z' })],
  };

  const bounded = boundMessagesCache(cache, [], { maxConversations: 1 });

  expect(Object.keys(bounded)).toEqual(['recent']);
});

it('keeps only the newest messages inside a conversation', () => {
  const list = Array.from({ length: 10 }, () => msg());
  const bounded = boundMessagesCache({ g: list }, [], { maxPerConversation: 4 });

  expect(bounded.g).toHaveLength(4);
  expect(bounded.g.map((m) => m.id)).toEqual(['m7', 'm8', 'm9', 'm10']);
});

it('never drops a message the student has not managed to send', () => {
  const stuck = msg({ createdAt: '2020-01-01T00:00:00.000Z', deliveryState: 'failed' });
  const queued = msg({ createdAt: '2020-01-02T00:00:00.000Z', deliveryState: 'pending' });
  const list = [stuck, queued, ...Array.from({ length: 8 }, () => msg())];

  const bounded = boundMessagesCache({ g: list }, [], { maxPerConversation: 3 });

  expect(bounded.g).toContain(stuck);
  expect(bounded.g).toContain(queued);
});

it('returns the same object when nothing needs dropping', () => {
  const cache = cacheOf(['a', 'b']);
  expect(boundMessagesCache(cache, [], { maxConversations: 5, maxPerConversation: 5 })).toBe(cache);
});

it('forgets the recency of a conversation it just evicted', () => {
  const cache = cacheOf(['a', 'b']);
  touchMessagesCache('a');
  touchMessagesCache('b');

  boundMessagesCache(cache, [], { maxConversations: 1 });

  // 'a' is gone from the cache, so its tick must not outrank a conversation
  // that is still there the next time the bound runs.
  const next = boundMessagesCache({ a: [msg()], b: cache.b }, [], { maxConversations: 1 });
  expect(Object.keys(next)).toEqual(['b']);
});
