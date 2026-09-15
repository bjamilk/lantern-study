/**
 * The user-scoped state registry (F8).
 *
 * What these lock down is the shared-handset failure: A signs out, B signs in
 * on the same phone, and B is shown A's chats, credits or quiz because the
 * state was in MEMORY (storage clearing does nothing to it) or under a storage
 * key with no account in it.
 */
const storage: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => (k in storage ? storage[k] : null)),
    setItem: jest.fn(async (k: string, v: string) => {
      storage[k] = v;
    }),
    removeItem: jest.fn(async (k: string) => {
      delete storage[k];
    }),
  },
}));

// ---------------------------------------------------------------------------
// Platform stand-ins for the REAL-STORE test at the bottom of this file.
//
// Only leaves are stubbed — native modules (react-native, expo-*), the network
// clients and the sync service. Every STORE below is the real one, because the
// whole point of that test is to catch a store that stops registering itself.
// ---------------------------------------------------------------------------
function mockDeepStub(): any {
  return new Proxy(function Stub() {} as any, {
    get: (_t, key) =>
      key === '__esModule' ? true : key === 'then' ? undefined : mockDeepStub(),
    apply: () => undefined,
    construct: () => ({}),
  });
}

jest.mock('react-native', () => mockDeepStub(), { virtual: true });
jest.mock('react-native-url-polyfill/auto', () => ({}), { virtual: true });
jest.mock('expo-secure-store', () => mockDeepStub(), { virtual: true });
jest.mock('expo-crypto', () => mockDeepStub(), { virtual: true });
jest.mock('expo-constants', () => mockDeepStub(), { virtual: true });
jest.mock('expo-web-browser', () => mockDeepStub(), { virtual: true });
jest.mock('expo-auth-session', () => mockDeepStub(), { virtual: true });
jest.mock('expo-auth-session/build/QueryParams', () => mockDeepStub(), { virtual: true });
jest.mock('expo-apple-authentication', () => mockDeepStub(), { virtual: true });
jest.mock('expo-file-system/legacy', () => mockDeepStub(), { virtual: true });
jest.mock('@react-native-community/netinfo', () => mockDeepStub(), { virtual: true });
// Mobile's jest maps '@lantern/shared/*' to the package source but has NO
// mapping for the bare specifier (see the note in companionStore).
jest.mock('@lantern/shared', () => mockDeepStub(), { virtual: true });
jest.mock('../services/supabase', () => mockDeepStub());
jest.mock('../services/syncService', () => mockDeepStub());
// The mapped '@lantern/shared/utils' stand-in is real but partial; anything it
// does not export is only reached at module scope here (e.g. a registry class).
jest.mock('@lantern/shared/utils', () => {
  const actual = jest.requireActual('@lantern/shared/utils');
  const fallbacks = new Map<string, any>();
  return new Proxy(actual as any, {
    get: (target: any, key: string) => {
      if (key in target) return target[key];
      if (!fallbacks.has(key)) fallbacks.set(key, mockDeepStub());
      return fallbacks.get(key);
    },
  });
});

import {
  __resetUserScopedStateForTests,
  getUserScopeId,
  isUserScopeResolved,
  readScopedWithLegacyMigration,
  registerUserScoped,
  registeredUserScopedNames,
  resetAllUserScopedState,
  scopedKey,
  setUserScopeId,
  subscribeToUserScope,
  whenUserScopeResolved,
} from './userScopedState';

beforeEach(() => {
  for (const k of Object.keys(storage)) delete storage[k];
  __resetUserScopedStateForTests();
});

describe('the registry resets every holder', () => {
  it('runs all registered resets, in registration order', async () => {
    const order: string[] = [];
    registerUserScoped('a', () => {
      order.push('a');
    });
    registerUserScoped('b', async () => {
      order.push('b');
    });

    await resetAllUserScopedState('sign-out');

    expect(order).toEqual(['a', 'b']);
  });

  it('keeps sweeping when one reset throws', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const later = jest.fn();
    registerUserScoped('broken', () => {
      throw new Error('boom');
    });
    registerUserScoped('later', later);

    await resetAllUserScopedState('sign-out');

    // A half-cleared handset is the bug this exists to prevent.
    expect(later).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('replaces a re-registration under the same name instead of stacking it', async () => {
    const first = jest.fn();
    const second = jest.fn();
    registerUserScoped('same', first);
    registerUserScoped('same', second);

    expect(registeredUserScopedNames()).toEqual(['same']);
    await resetAllUserScopedState('account-switch');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('the scope id', () => {
  it('is unresolved until auth answers, then resolves every waiter', async () => {
    expect(isUserScopeResolved()).toBe(false);
    const waiting = whenUserScopeResolved();

    await setUserScopeId('user-a');

    await expect(waiting).resolves.toBe('user-a');
    expect(getUserScopeId()).toBe('user-a');
  });

  it('sweeps on an account switch with no sign-out in between', async () => {
    const reset = jest.fn();
    registerUserScoped('store', reset);

    await setUserScopeId('user-a');
    expect(reset).not.toHaveBeenCalled();

    await setUserScopeId('user-b');
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('does not sweep when the same account resolves twice', async () => {
    const reset = jest.fn();
    registerUserScoped('store', reset);

    await setUserScopeId('user-a');
    await setUserScopeId('user-a');

    expect(reset).not.toHaveBeenCalled();
  });

  it('tells subscribers when the scope changes', async () => {
    const seen: (string | null)[] = [];
    subscribeToUserScope((id) => seen.push(id));

    await setUserScopeId('user-a');
    await setUserScopeId('user-b');
    await setUserScopeId(null);

    expect(seen).toEqual(['user-a', 'user-b', null]);
  });
});

describe('scoped storage keys', () => {
  it('gives two accounts different keys', () => {
    expect(scopedKey('lantern.aiUsage.last', 'user-a')).toBe('lantern.aiUsage.last:user-a');
    expect(scopedKey('lantern.aiUsage.last', 'user-a')).not.toBe(
      scopedKey('lantern.aiUsage.last', 'user-b')
    );
  });

  it('adopts the legacy unscoped value into the first account that reads it', async () => {
    storage['base'] = 'legacy-value';

    await expect(readScopedWithLegacyMigration('base', 'user-a')).resolves.toBe('legacy-value');

    expect(storage['base:user-a']).toBe('legacy-value');
    // The legacy key is gone, so a second account can never inherit it.
    expect(storage['base']).toBeUndefined();
  });

  it('never hands one account another account s value', async () => {
    storage['base'] = 'a-value';
    await readScopedWithLegacyMigration('base', 'user-a');

    await expect(readScopedWithLegacyMigration('base', 'user-b')).resolves.toBeNull();
    expect(storage['base:user-a']).toBe('a-value');
    expect(storage['base:user-b']).toBeUndefined();
  });

  it('prefers the scoped value and clears a legacy leftover behind it', async () => {
    storage['base:user-a'] = 'mine';
    storage['base'] = 'stale-leftover';

    await expect(readScopedWithLegacyMigration('base', 'user-a')).resolves.toBe('mine');
    await Promise.resolve();
    expect(storage['base']).toBeUndefined();
  });
});

/**
 * The registry, against the REAL stores (review M7).
 *
 * `registerUserScoped` is opt-in at module scope, so the failure this exists to
 * catch is silent: a store that is lazily imported, renamed or simply forgets
 * the call never registers, and on a shared handset the next account is shown
 * the previous student's data with nothing failing. A test that registers its
 * own fake holder cannot see that — so this one imports the actual stores,
 * seeds each with account A's data, sweeps, and checks the data is gone.
 *
 * `jest.resetModules()` gives the stores a private copy of the registry, so
 * they register into it at import time despite the `beforeEach` above having
 * cleared the shared one.
 */
describe('the real stores register themselves and are actually cleared', () => {
  /**
   * One probe per registered name: seed account A's data, then report whether
   * anything of A's is still there. `name` must match the string the store
   * passes to `registerUserScoped` — that is the coupling under test.
   */
  type Probe = {
    name: string;
    seed: () => void;
    isDirty: () => boolean;
  };

  const loadRealStores = (): { scope: typeof import('./userScopedState'); probes: Probe[] } => {
    jest.resetModules();
    const scope: typeof import('./userScopedState') = require('./userScopedState');
    const { useGroupStore } = require('./groupStore');
    const { useCompanionStore } = require('./companionStore');
    const { useStudyGoalsStore } = require('./studyGoalsStore');
    const aiUsage = require('../services/aiUsageStore');

    const probes: Probe[] = [
      {
        name: 'groupStore',
        seed: () =>
          useGroupStore.setState({
            groups: [{ id: 'g1', name: "A's study group" }],
            currentGroup: { id: 'g1', name: "A's study group" },
            activeGroupId: 'g1',
            messages: [{ id: 'm1', content: "A's message" }],
            messagesCache: { g1: [{ id: 'm1' }] },
            dmThreads: [{ id: 'dm1' }],
            groupUnreadCounts: { g1: 3 },
          }),
        isDirty: () => {
          const s = useGroupStore.getState();
          return (
            s.groups.length > 0 ||
            s.currentGroup !== null ||
            s.activeGroupId !== null ||
            s.messages.length > 0 ||
            Object.keys(s.messagesCache).length > 0 ||
            s.dmThreads.length > 0 ||
            Object.keys(s.groupUnreadCounts).length > 0
          );
        },
      },
      {
        name: 'companionStore',
        seed: () =>
          useCompanionStore.setState({
            isOpen: true,
            messages: [{ id: 'c1', role: 'user', content: "A's question" }],
            conversations: [{ id: 'conv-1', title: "A's chat" }],
            historyLoaded: true,
            activeConversationId: 'conv-1',
          }),
        isDirty: () => {
          const s = useCompanionStore.getState();
          return (
            s.isOpen ||
            s.messages.length > 0 ||
            s.conversations.length > 0 ||
            s.historyLoaded ||
            s.activeConversationId !== null
          );
        },
      },
      {
        name: 'studyGoals',
        seed: () =>
          useStudyGoalsStore.setState({
            studyGoal: 'speed',
            dailyQuiz: { id: 'quiz-a', questions: [{ id: 'q1' }] },
            dailyQuizProgress: 2,
          }),
        isDirty: () => {
          const s = useStudyGoalsStore.getState();
          return s.dailyQuiz !== null || s.dailyQuizProgress !== 0 || s.studyGoal !== 'retention';
        },
      },
      {
        name: 'aiUsage',
        seed: () =>
          aiUsage.publishAIUsage({ used: 93, limit: 100, remaining: 7, resetsAt: '2026-01-02' }),
        isDirty: () => aiUsage.getLatestAIUsage().limit > 0,
      },
    ];

    return { scope, probes };
  };

  it('registers every store this test knows about — and nothing it does not', () => {
    const { scope, probes } = loadRealStores();

    // "At least these four": a store that stops registering fails here.
    expect(scope.registeredUserScopedNames().sort()).toEqual(
      expect.arrayContaining(['aiUsage', 'companionStore', 'groupStore', 'studyGoals'])
    );
    // And a NEW registration must add a probe below, or it is untested.
    expect(scope.registeredUserScopedNames().sort()).toEqual(probes.map((p) => p.name).sort());
  });

  it('drops account A s data from every registered holder on sign-out', async () => {
    const { scope, probes } = loadRealStores();

    probes.forEach((probe) => probe.seed());
    // The seeds have to actually land, or the sweep proves nothing.
    expect(probes.filter((p) => p.isDirty()).map((p) => p.name).sort()).toEqual(
      probes.map((p) => p.name).sort()
    );

    await scope.resetAllUserScopedState('sign-out');

    expect(probes.filter((p) => p.isDirty()).map((p) => p.name)).toEqual([]);
  });

  it('drops it on an account switch too — B never sees A s frame', async () => {
    const { scope, probes } = loadRealStores();

    await scope.setUserScopeId('user-a');
    probes.forEach((probe) => probe.seed());

    await scope.setUserScopeId('user-b');

    expect(probes.filter((p) => p.isDirty()).map((p) => p.name)).toEqual([]);
  });
});
