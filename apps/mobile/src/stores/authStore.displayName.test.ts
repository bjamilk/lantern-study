/**
 * `displayNameFromUser` is the auth store's fallback identity — the name the app
 * stamps on the viewer's own chat and board cards until the server's copy
 * lands, and a board shows those to everyone. It must route through the shared
 * planner, so it can never seed a name from the email address (the old top-bar
 * "NI", from the local part of "nimaj22@…").
 *
 * The RN/Expo modules the store reaches at import time are mocked; the real
 * ones pull expo-secure-store into a node-environment suite and kill it.
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
  readStoredSession: jest.fn(),
  API_BASE_URL: 'http://localhost:3001',
  getAuthHeaders: jest.fn(async () => ({})),
}));

jest.mock('../services/ensureUserProfile', () => ({
  __esModule: true,
  ensureUserProfile: jest.fn(),
}));

jest.mock('../services/api', () => ({
  __esModule: true,
  fetchUserProfile: jest.fn(),
}));

jest.mock('../services/socialAuth', () => ({
  __esModule: true,
  signInWithGoogleOAuth: jest.fn(),
  signInWithAppleNative: jest.fn(),
}));

jest.mock('@lantern/shared', () => ({ __esModule: true, isEmailNotConfirmedError: () => false }), {
  virtual: true,
});

import { displayNameFromUser } from './authStore';

function user(over: Record<string, unknown> = {}): any {
  return { id: 'user-1', email: 'nimaj22@gmail.com', user_metadata: {}, ...over };
}

describe('displayNameFromUser', () => {
  it('returns a genuine metadata name', () => {
    expect(displayNameFromUser(user({ user_metadata: { name: 'Benjamin Amadi' } }))).toBe(
      'Benjamin Amadi'
    );
  });

  it('NEVER returns the email local part when there is no name', () => {
    // The regression: offline, with no profile row, this used to synthesise
    // "nimaj22" and the top bar drew it as an "NI" chip.
    expect(displayNameFromUser(user())).toBeNull();
  });

  it('drops a literal address held in metadata.name', () => {
    expect(
      displayNameFromUser(user({ user_metadata: { name: 'nimaj22@gmail.com' } }))
    ).toBeNull();
  });

  it('keeps a genuine name that happens to equal the email local part', () => {
    expect(
      displayNameFromUser(user({ email: 'ada@uni.edu', user_metadata: { name: 'ada' } }))
    ).toBe('ada');
  });
});
