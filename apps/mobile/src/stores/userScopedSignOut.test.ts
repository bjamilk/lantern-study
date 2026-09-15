/**
 * Sign-out sweeps the user-scoped registry (F8).
 *
 * `signOut` clears AsyncStorage keys, which does nothing to a hydrated store or
 * a module-level cache — that is how the next account on a shared handset was
 * shown the previous student's chats and credits. This pins the wiring: the ONE
 * sign-out path calls `resetAllUserScopedState`, and it does so with the scope
 * already nulled, so a reset that re-reads its own storage cannot be handed the
 * departing account's id.
 *
 * Every React Native / Expo module authStore reaches is mocked — and so are the
 * stores it touches, because the real ones pull expo-secure-store into a
 * node-environment suite and kill it. That makes this file a test of the WIRING
 * only: it cannot see a store that stops registering itself. The registry
 * against the real stores lives in `userScopedState.test.ts`
 * ("the real stores register themselves and are actually cleared", review M7).
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

jest.mock('../services/supabase', () => ({
  __esModule: true,
  supabase: { auth: { refreshSession: jest.fn() } },
  signInWithEmail: jest.fn(),
  signUpWithEmail: jest.fn(),
  signOut: jest.fn(async () => undefined),
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe: jest.fn() } } }),
  readStoredSession: jest.fn(async () => null),
  API_BASE_URL: 'http://localhost:3001',
  getAuthHeaders: jest.fn(async () => ({})),
}));

jest.mock('../services/ensureUserProfile', () => ({
  __esModule: true,
  ensureUserProfile: jest.fn(),
}));
jest.mock('../services/api', () => ({
  __esModule: true,
  fetchUserProfile: jest.fn(async () => ({ name: 'Name' })),
}));
jest.mock('../services/socialAuth', () => ({
  __esModule: true,
  signInWithGoogleOAuth: jest.fn(),
  signInWithAppleNative: jest.fn(),
}));
jest.mock('@lantern/shared', () => ({ __esModule: true, isEmailNotConfirmedError: () => false }), {
  virtual: true,
});
jest.mock('./marketplaceStore', () => ({
  __esModule: true,
  LEGACY_MARKETPLACE_STORAGE_KEYS: [],
  useMarketplaceStore: { getState: () => ({ reset: async () => undefined }) },
}));
jest.mock('./chatWallpaperStore', () => ({
  __esModule: true,
  useChatWallpaperStore: { getState: () => ({ reset: () => undefined }) },
}));
jest.mock('./offlineStore', () => ({
  __esModule: true,
  useOfflineStore: { setState: () => undefined },
}));
jest.mock('../utils/signedUrlCache', () => ({
  __esModule: true,
  clearSignedUrlCache: () => undefined,
}));
jest.mock('./settingsStore', () => ({
  __esModule: true,
  clearLocalSettings: async () => undefined,
}));

import { useAuthStore } from './authStore';
import {
  __resetUserScopedStateForTests,
  getUserScopeId,
  registerUserScoped,
  setUserScopeId,
} from './userScopedState';

const USER = { id: 'user-a', email: 'a@example.com', user_metadata: {} };
const SESSION = {
  access_token: 'a',
  refresh_token: 'r',
  expires_at: 1,
  user: USER,
};

beforeEach(() => {
  __resetUserScopedStateForTests();
  useAuthStore.setState({
    user: USER,
    session: SESSION,
    sessionState: 'authenticated',
    isInitialized: true,
    isLoading: false,
    error: null,
  } as never);
});

it('sweeps every registered holder when the student signs out', async () => {
  const reset = jest.fn();
  registerUserScoped('some-store', reset);
  await setUserScopeId('user-a');

  await useAuthStore.getState().signOut({ reason: 'user' });

  expect(reset).toHaveBeenCalledTimes(1);
});

it('sweeps on a revoked session too — the data is still the wrong account s', async () => {
  const reset = jest.fn();
  registerUserScoped('some-store', reset);
  await setUserScopeId('user-a');

  await useAuthStore.getState().signOut({ reason: 'revoked' });

  expect(reset).toHaveBeenCalledTimes(1);
});

it('nulls the scope BEFORE the sweep, so no reset re-reads the departing account', async () => {
  let scopeDuringReset: string | null | undefined;
  registerUserScoped('re-reader', () => {
    scopeDuringReset = getUserScopeId();
  });
  await setUserScopeId('user-a');

  await useAuthStore.getState().signOut({ reason: 'user' });

  expect(scopeDuringReset).toBeNull();
  expect(getUserScopeId()).toBeNull();
});

it('publishes the signed-in account to the registry when auth resolves', async () => {
  __resetUserScopedStateForTests();
  useAuthStore.setState({
    user: { id: 'user-b' },
    sessionState: 'authenticated',
    isInitialized: true,
  } as never);

  // The subscription is synchronous; setUserScopeId's async tail is not.
  await Promise.resolve();
  expect(getUserScopeId()).toBe('user-b');
});
