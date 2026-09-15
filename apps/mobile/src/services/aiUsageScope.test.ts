/**
 * AI credits belong to one account (F8).
 *
 * The cache key `lantern.aiUsage.last` was global and the counters were a
 * module global that no sign-out touched, so after an account switch B's badge
 * read "3 credits left" from A's figures and B's generation gates fired on
 * them. These pin the scoping and the reset.
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

import {
  AI_USAGE_CACHE_LEGACY_KEY,
  __resetAIUsageForTests,
  getLatestAIUsage,
  hydrateAIUsageFromCache,
  publishAIUsage,
} from './aiUsageStore';
import { resetAllUserScopedState, setUserScopeId } from '../stores/userScopedState';

const usage = { used: 97, limit: 100, remaining: 3, resetsAt: '' };

const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(async () => {
  for (const k of Object.keys(storage)) delete storage[k];
  __resetAIUsageForTests();
  // The registry is NOT wiped: aiUsageStore registers its reset at import time
  // and nothing can put that back for the sweep test below.
  await setUserScopeId(null);
});

it('files the counters under the signed-in account', async () => {
  await setUserScopeId('user-a');
  publishAIUsage(usage);
  await flush();

  expect(storage[`${AI_USAGE_CACHE_LEGACY_KEY}:user-a`]).toBeTruthy();
  expect(storage[AI_USAGE_CACHE_LEGACY_KEY]).toBeUndefined();
});

it('does not restore another account s allowance', async () => {
  await setUserScopeId('user-a');
  publishAIUsage(usage);
  await flush();

  __resetAIUsageForTests();
  await setUserScopeId('user-b');

  await expect(hydrateAIUsageFromCache()).resolves.toBe(false);
  expect(getLatestAIUsage().limit).toBe(0);
});

it('restores this account s own cached allowance', async () => {
  await setUserScopeId('user-a');
  publishAIUsage(usage);
  await flush();

  __resetAIUsageForTests();
  await setUserScopeId('user-a');

  await expect(hydrateAIUsageFromCache()).resolves.toBe(true);
  expect(getLatestAIUsage().remaining).toBe(3);
});

it('writes nothing while signed out', async () => {
  await setUserScopeId(null);
  publishAIUsage(usage);
  await flush();

  expect(Object.keys(storage)).toEqual([]);
});

it('drops the counters when the registry sweeps', async () => {
  await setUserScopeId('user-a');
  publishAIUsage(usage);
  expect(getLatestAIUsage().remaining).toBe(3);

  // The order sign-out uses: scope first, then the sweep.
  await setUserScopeId(null);
  await resetAllUserScopedState('sign-out');

  // limit 0 is this codebase's "we have not been told" — never a number B
  // could act on.
  expect(getLatestAIUsage().limit).toBe(0);
});
