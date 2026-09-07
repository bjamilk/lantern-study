/**
 * Store-level guards for the cold-boot session restore.
 *
 * The regression these lock down: `initialize()` raced `refreshSession()`
 * against an 8 s timeout and, on timeout, set `user: null`. That rendered the
 * sign-in screen to a signed-in student, tore down every realtime channel and
 * reset the theme — all of it undone ~15 s later.
 *
 * Every React Native / Expo module authStore reaches is mocked: the real ones
 * pull expo-secure-store into a node-environment suite and kill it.
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

const refreshSession = jest.fn();
const authStateHandlers: Array<(event: string, session: unknown) => void> = [];

jest.mock('../services/supabase', () => ({
  __esModule: true,
  supabase: { auth: { refreshSession: (...args: unknown[]) => refreshSession(...args) } },
  signInWithEmail: jest.fn(),
  signUpWithEmail: jest.fn(),
  signOut: jest.fn(async () => undefined),
  onAuthStateChange: (handler: (event: string, session: unknown) => void) => {
    authStateHandlers.push(handler);
    return { data: { subscription: { unsubscribe: jest.fn() } } };
  },
  readStoredSession: () => mockReadStoredSession(),
  API_BASE_URL: 'http://localhost:3001',
  getAuthHeaders: jest.fn(async () => ({})),
}));

const ensureUserProfile = jest.fn(async () => ({
  displayName: 'Fresh Name',
  firstName: 'Fresh',
  academic: null,
}));
jest.mock('../services/ensureUserProfile', () => ({
  __esModule: true,
  ensureUserProfile: (...args: unknown[]) => ensureUserProfile(...(args as [])),
}));

jest.mock('../services/api', () => ({
  __esModule: true,
  fetchUserProfile: jest.fn(async () => ({ name: 'Fresh Name' })),
}));

jest.mock('../services/socialAuth', () => ({
  __esModule: true,
  signInWithGoogleOAuth: jest.fn(),
  signInWithAppleNative: jest.fn(),
}));

jest.mock('@lantern/shared', () => ({ __esModule: true, isEmailNotConfirmedError: () => false }), {
  virtual: true,
});

// The real signOut() reaches these lazily; each would drag React Native
// modules into a node-environment suite.
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

const mockReadStoredSession = jest.fn();

import { useAuthStore } from './authStore';
import { useUIStore } from './uiStore';

const STORED_SESSION = {
  access_token: 'stored-access-token',
  refresh_token: 'stored-refresh-token',
  expires_at: 1,
  user: { id: 'user-1', email: 'nimaj22@gmail.com', user_metadata: { name: 'Benjamin A' } },
};

const FRESH_SESSION = {
  ...STORED_SESSION,
  access_token: 'fresh-access-token',
};

/** Never resolves — stands in for the stalled refresh that started all this. */
const stalledRefresh = () => new Promise(() => {});

/** Tests swap `signOut` for a spy; the real action has to come back for the next one. */
const realSignOut = useAuthStore.getState().signOut;

function resetStore() {
  useAuthStore.setState({
    signOut: realSignOut,
    user: null,
    session: null,
    profileName: null,
    profileFirstName: null,
    academicProfile: null,
    isLoading: false,
    isInitialized: false,
    sessionState: 'signed-out',
    isPasswordRecovery: false,
    error: null,
  });
  useUIStore.setState({ authOffline: false });
}

beforeEach(() => {
  jest.useFakeTimers();
  authStateHandlers.length = 0;
  refreshSession.mockReset();
  mockReadStoredSession.mockReset();
  ensureUserProfile.mockClear();
  resetStore();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

/** A refresh whose answer the test controls. */
function deferredRefresh() {
  let resolve!: (value: { data: { session: unknown }; error: null }) => void;
  const promise = new Promise<{ data: { session: unknown }; error: null }>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Let queued microtasks run without advancing the fake clock. */
const flush = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

describe('initialize() with a stored session and a refresh that never answers', () => {
  it('never sets user to null and never signs out', async () => {
    mockReadStoredSession.mockResolvedValue(STORED_SESSION);
    refreshSession.mockImplementation(stalledRefresh);

    const signOut = jest.fn(async () => undefined);
    useAuthStore.setState({ signOut });

    const seenUsers: Array<string | null> = [];
    const unsubscribe = useAuthStore.subscribe((state) => {
      seenUsers.push(state.user?.id ?? null);
    });

    const booting = useAuthStore.getState().initialize();

    // The stored session must be on screen before the refresh is even given a
    // chance — no 8 s of BootLoadingScreen, no sign-in route.
    await flush();
    expect(useAuthStore.getState().user?.id).toBe('user-1');
    expect(useAuthStore.getState().sessionState).toBe('restoring');
    expect(useAuthStore.getState().isInitialized).toBe(true);

    // Now blow the 8 s boot budget.
    jest.advanceTimersByTime(8_001);
    await booting;
    await flush();

    expect(useAuthStore.getState().user?.id).toBe('user-1');
    expect(useAuthStore.getState().session?.access_token).toBe('stored-access-token');
    expect(useAuthStore.getState().sessionState).toBe('restoring');
    expect(signOut).not.toHaveBeenCalled();
    // The pre-boot null is the starting state; what must never happen is the
    // store publishing null again AFTER it has published the restored user.
    expect(seenUsers.slice(seenUsers.indexOf('user-1'))).not.toContain(null);

    unsubscribe();
  });

  it('shows exactly one quiet line and keeps retrying', async () => {
    mockReadStoredSession.mockResolvedValue(STORED_SESSION);
    refreshSession.mockImplementation(stalledRefresh);

    const booting = useAuthStore.getState().initialize();
    await flush();
    jest.advanceTimersByTime(8_001);
    await booting;
    await flush();

    expect(useUIStore.getState().authOffline).toBe(true);

    // First retry after 1 s; it stalls again, so a second is scheduled.
    expect(refreshSession).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1_000);
    await flush();
    expect(refreshSession).toHaveBeenCalledTimes(2);
    expect(useAuthStore.getState().user?.id).toBe('user-1');
  });

  it('promotes to authenticated when a retry finally lands', async () => {
    mockReadStoredSession.mockResolvedValue(STORED_SESSION);
    refreshSession.mockImplementationOnce(stalledRefresh);

    const booting = useAuthStore.getState().initialize();
    await flush();
    jest.advanceTimersByTime(8_001);
    await booting;
    await flush();

    refreshSession.mockResolvedValue({ data: { session: FRESH_SESSION }, error: null });
    jest.advanceTimersByTime(1_000);
    await flush();

    expect(useAuthStore.getState().sessionState).toBe('authenticated');
    expect(useAuthStore.getState().session?.access_token).toBe('fresh-access-token');
    expect(useUIStore.getState().authOffline).toBe(false);
  });
});

describe('initialize() the rest of the matrix', () => {
  it('uses the refreshed session when the network is fine', async () => {
    mockReadStoredSession.mockResolvedValue(STORED_SESSION);
    refreshSession.mockResolvedValue({ data: { session: FRESH_SESSION }, error: null });

    await useAuthStore.getState().initialize();
    await flush();

    expect(useAuthStore.getState().sessionState).toBe('authenticated');
    expect(useAuthStore.getState().session?.access_token).toBe('fresh-access-token');
    expect(useAuthStore.getState().profileName).toBe('Fresh Name');
    expect(useUIStore.getState().authOffline).toBe(false);
  });

  it('signs out with the revoked reason only on a definitive refusal', async () => {
    mockReadStoredSession.mockResolvedValue(STORED_SESSION);
    refreshSession.mockResolvedValue({
      data: { session: null },
      error: { name: 'AuthApiError', status: 400, code: 'invalid_grant', message: 'Invalid Refresh Token' },
    });

    const signOut = jest.fn(async () => undefined);
    useAuthStore.setState({ signOut });

    await useAuthStore.getState().initialize();
    await flush();

    expect(signOut).toHaveBeenCalledWith({ reason: 'revoked' });
    expect(useAuthStore.getState().sessionState).toBe('signed-out');
  });

  it('does NOT sign out on a bare 400 with no proof', async () => {
    mockReadStoredSession.mockResolvedValue(STORED_SESSION);
    refreshSession.mockResolvedValue({
      data: { session: null },
      error: { name: 'AuthApiError', status: 400, message: 'Bad Request' },
    });

    const signOut = jest.fn(async () => undefined);
    useAuthStore.setState({ signOut });

    await useAuthStore.getState().initialize();
    await flush();

    expect(signOut).not.toHaveBeenCalled();
    expect(useAuthStore.getState().user?.id).toBe('user-1');
    expect(useAuthStore.getState().sessionState).toBe('restoring');
  });

  it('routes to sign-in when nothing is stored and nothing comes back', async () => {
    mockReadStoredSession.mockResolvedValue(null);
    refreshSession.mockRejectedValue(new TypeError('Network request failed'));

    const signOut = jest.fn(async () => undefined);
    useAuthStore.setState({ signOut });

    await useAuthStore.getState().initialize();
    await flush();

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().sessionState).toBe('signed-out');
    expect(useAuthStore.getState().isInitialized).toBe(true);
    // Nothing to revoke: the sign-out path must not run.
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe('realtime and auto-sync see one stable user id', () => {
  /**
   * Realtime and auto-sync both key on `user?.id`. Every distinct value the
   * store publishes is one start/stop for them, so the restore must publish
   * exactly one id and never a null — the old boot published
   * null → null → user, which is the start-stop-start in the logcat.
   */
  it('publishes the user id once and never revokes it mid-boot', async () => {
    mockReadStoredSession.mockResolvedValue(STORED_SESSION);
    refreshSession.mockImplementationOnce(stalledRefresh);

    const observed: Array<string | undefined> = [];
    const unsubscribe = useAuthStore.subscribe((state) => {
      const id = state.user?.id;
      if (observed[observed.length - 1] !== id) observed.push(id);
    });

    const booting = useAuthStore.getState().initialize();
    await flush();
    jest.advanceTimersByTime(8_001);
    await booting;
    await flush();

    refreshSession.mockResolvedValue({ data: { session: FRESH_SESSION }, error: null });
    jest.advanceTimersByTime(1_000);
    await flush();

    expect(observed).toEqual(['user-1']);
    unsubscribe();
  });

  it('an INITIAL_SESSION replaying the stored token does not end the restore', async () => {
    mockReadStoredSession.mockResolvedValue(STORED_SESSION);
    refreshSession.mockImplementation(stalledRefresh);

    const booting = useAuthStore.getState().initialize();
    await flush();
    jest.advanceTimersByTime(8_001);
    await booting;
    // The listener is installed on a zero-delay timer.
    jest.advanceTimersByTime(1);
    await flush();

    expect(authStateHandlers).toHaveLength(1);
    authStateHandlers[0]('INITIAL_SESSION', STORED_SESSION);

    expect(useAuthStore.getState().sessionState).toBe('restoring');
    expect(useUIStore.getState().authOffline).toBe(true);

    // A genuinely new token does end it.
    authStateHandlers[0]('TOKEN_REFRESHED', FRESH_SESSION);
    expect(useAuthStore.getState().sessionState).toBe('authenticated');
    expect(useUIStore.getState().authOffline).toBe(false);
  });
});

describe('a session the student ended is never resurrected by a refresh that lands late', () => {
  /**
   * The app is interactive on the stored session while the boot refresh is
   * still in flight. Sign out at 3 s, refresh answers at 7 s: that answer
   * describes an account that no longer exists on this handset.
   */
  it('boot refresh landing after a sign-out is discarded', async () => {
    mockReadStoredSession.mockResolvedValue(STORED_SESSION);
    const refresh = deferredRefresh();
    refreshSession.mockImplementationOnce(() => refresh.promise);

    const booting = useAuthStore.getState().initialize();
    await flush();
    expect(useAuthStore.getState().user?.id).toBe('user-1');

    // The student taps Sign out while the refresh is still pending.
    await useAuthStore.getState().signOut({ reason: 'user' });
    expect(useAuthStore.getState().user).toBeNull();

    refresh.resolve({ data: { session: FRESH_SESSION }, error: null });
    await booting;
    await flush();

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().session).toBeNull();
    expect(useAuthStore.getState().sessionState).toBe('signed-out');
    expect(ensureUserProfile).not.toHaveBeenCalled();
  });

  it('a retry-ladder refresh landing after SIGNED_OUT is discarded', async () => {
    mockReadStoredSession.mockResolvedValue(STORED_SESSION);
    refreshSession.mockImplementationOnce(stalledRefresh);

    const booting = useAuthStore.getState().initialize();
    await flush();
    jest.advanceTimersByTime(8_001);
    await booting;
    jest.advanceTimersByTime(1); // the listener is installed on a zero-delay timer
    await flush();
    expect(useAuthStore.getState().sessionState).toBe('restoring');

    // First ladder retry fires at 1 s and is answered only later.
    const retry = deferredRefresh();
    refreshSession.mockImplementationOnce(() => retry.promise);
    jest.advanceTimersByTime(1_000);
    await flush();
    expect(refreshSession).toHaveBeenCalledTimes(2);

    // auth-js ends the session while that retry is in flight.
    authStateHandlers[0]('SIGNED_OUT', null);
    expect(useAuthStore.getState().user).toBeNull();

    retry.resolve({ data: { session: FRESH_SESSION }, error: null });
    await flush();

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().sessionState).toBe('signed-out');
    // And the ladder is gone: no further refresh is attempted.
    jest.advanceTimersByTime(120_000);
    await flush();
    expect(refreshSession).toHaveBeenCalledTimes(2);
  });
});

describe('initialize() called again on a session this launch already confirmed', () => {
  it('keeps the real display name and the authenticated state through the second refresh', async () => {
    mockReadStoredSession.mockResolvedValue(STORED_SESSION);
    refreshSession.mockResolvedValueOnce({ data: { session: FRESH_SESSION }, error: null });
    await useAuthStore.getState().initialize();
    await flush();
    expect(useAuthStore.getState().profileName).toBe('Fresh Name');
    expect(useAuthStore.getState().sessionState).toBe('authenticated');

    // A remount (font-scale key) calls initialize() again; the refresh is slow.
    const second = deferredRefresh();
    refreshSession.mockImplementationOnce(() => second.promise);
    const rebooting = useAuthStore.getState().initialize();
    await flush();

    expect(useAuthStore.getState().profileName).toBe('Fresh Name');
    expect(useAuthStore.getState().sessionState).toBe('authenticated');
    expect(useUIStore.getState().authOffline).toBe(false);

    second.resolve({ data: { session: FRESH_SESSION }, error: null });
    await rebooting;
    await flush();
    expect(useAuthStore.getState().sessionState).toBe('authenticated');
  });
});
