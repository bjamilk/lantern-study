/**
 * What the Android session storage must guarantee, in the order the incidents
 * happened: it must never freeze boot on a wedged Keystore, it must not leave a
 * plaintext session behind, and it must not lock a signed-in student out
 * because a native call was slow.
 */

const secureStore = new Map<string, string>();
const asyncStore = new Map<string, string>();

let getItemAsyncImpl: (key: string) => Promise<string | null> = async (key) =>
  secureStore.get(key) ?? null;
let setItemAsyncImpl: (key: string, value: string) => Promise<void> = async (key, value) => {
  secureStore.set(key, value);
};
/** Every SecureStore write attempt, so "did this mint a key?" is assertable. */
const setItemAsyncCalls: string[] = [];

jest.mock('expo-secure-store', () => ({
  getItemAsync: (key: string) => getItemAsyncImpl(key),
  setItemAsync: (key: string, value: string) => {
    setItemAsyncCalls.push(key);
    return setItemAsyncImpl(key, value);
  },
  deleteItemAsync: async (key: string) => {
    secureStore.delete(key);
  },
}));

let randomCalls = 0;
jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: async (n: number) => {
    randomCalls += 1;
    return Uint8Array.from({ length: n }, (_, i) => (i * 7 + randomCalls * 31) % 256);
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => asyncStore.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      asyncStore.set(key, value);
    },
    removeItem: async (key: string) => {
      asyncStore.delete(key);
    },
  },
}));

import {
  AES_GCM_CIPHER,
  EncryptedSessionStorageAdapter as adapter,
  PASSTHROUGH_CIPHER,
  SESSION_KEY_STORE_KEY,
  setSessionCipher,
  __resetSessionStorageForTests,
  type SessionCipher,
} from './secureSessionStorage';

const KEY = 'sb-project-auth-token';
const SESSION = JSON.stringify({ access_token: 'a.b.c', refresh_token: 'r-1', expires_at: 1 });

/**
 * A cheap double for the adapter-behaviour tests (timeouts, caching), so those
 * are not also testing AES. The cipher itself is tested against the real thing.
 */
const reversingCipher: SessionCipher = {
  alg: 'test-reverse',
  async encrypt(plaintext, keyHex) {
    return `${keyHex.slice(0, 4)}:${[...plaintext].reverse().join('')}`;
  },
  async decrypt(ciphertext, keyHex) {
    const [prefix, ...rest] = ciphertext.split(':');
    if (prefix !== keyHex.slice(0, 4)) return null;
    return [...rest.join(':')].reverse().join('');
  },
};

const KEY_HEX = 'ab'.repeat(32);

beforeEach(() => {
  secureStore.clear();
  asyncStore.clear();
  getItemAsyncImpl = async (key) => secureStore.get(key) ?? null;
  setItemAsyncImpl = async (key, value) => {
    secureStore.set(key, value);
  };
  setItemAsyncCalls.length = 0;
  __resetSessionStorageForTests();
  randomCalls = 0;
  jest.restoreAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('AES-256-GCM', () => {
  it('round-trips through the real cipher', async () => {
    const sealed = await AES_GCM_CIPHER.encrypt(SESSION, KEY_HEX, KEY);
    expect(sealed).not.toContain('refresh_token');
    expect(sealed).toMatch(/^[0-9a-f]{24}\.[0-9a-f]+$/);
    expect(await AES_GCM_CIPHER.decrypt(sealed, KEY_HEX, KEY)).toBe(SESSION);
  });

  it('uses a fresh 96-bit nonce per write, so the same session never repeats', async () => {
    const a = await AES_GCM_CIPHER.encrypt(SESSION, KEY_HEX, KEY);
    const b = await AES_GCM_CIPHER.encrypt(SESSION, KEY_HEX, KEY);
    expect(a.slice(0, 24)).toHaveLength(24);
    expect(a).not.toBe(b);
  });

  it('returns null rather than throwing when a byte is flipped', async () => {
    const sealed = await AES_GCM_CIPHER.encrypt(SESSION, KEY_HEX, KEY);
    const cut = sealed.length - 5;
    const flipped = `${sealed.slice(0, cut)}${sealed[cut] === 'a' ? 'b' : 'a'}${sealed.slice(cut + 1)}`;

    // A throw here would land inside auth-js's own init — the boot hang again.
    await expect(AES_GCM_CIPHER.decrypt(flipped, KEY_HEX, KEY)).resolves.toBeNull();
    await expect(AES_GCM_CIPHER.decrypt('not-a-payload', KEY_HEX, KEY)).resolves.toBeNull();
    await expect(AES_GCM_CIPHER.decrypt('beef.cafe', KEY_HEX, KEY)).resolves.toBeNull();
  });

  it('will not open a ciphertext under another storage key (AAD binding)', async () => {
    const sealed = await AES_GCM_CIPHER.encrypt(SESSION, KEY_HEX, KEY);
    expect(await AES_GCM_CIPHER.decrypt(sealed, KEY_HEX, 'sb-other-auth-token')).toBeNull();
  });

  it('will not open a ciphertext under another key', async () => {
    const sealed = await AES_GCM_CIPHER.encrypt(SESSION, KEY_HEX, KEY);
    expect(await AES_GCM_CIPHER.decrypt(sealed, 'cd'.repeat(32), KEY)).toBeNull();
  });
});

describe('the shipped default', () => {
  it('encrypts without anyone installing a cipher first', async () => {
    await adapter.setItem(KEY, SESSION);
    const onDisk = asyncStore.get(KEY)!;
    expect(onDisk).toContain('aes-256-gcm');
    expect(onDisk).not.toContain('refresh_token');

    __resetSessionStorageForTests();
    expect(await adapter.getItem(KEY)).toBe(SESSION);
  });

  it('treats a tampered stored session as no session', async () => {
    await adapter.setItem(KEY, SESSION);
    const envelope = JSON.parse(asyncStore.get(KEY)!) as { ct: string };
    const cut = envelope.ct.length - 3;
    envelope.ct = `${envelope.ct.slice(0, cut)}${envelope.ct[cut] === 'a' ? 'b' : 'a'}${envelope.ct.slice(cut + 1)}`;
    asyncStore.set(KEY, JSON.stringify({ t: 'lantern-session', v: 1, alg: 'aes-256-gcm', ...envelope }));
    __resetSessionStorageForTests();

    await expect(adapter.getItem(KEY)).resolves.toBeNull();
  });

  it('will not decrypt a session blob moved to another entry', async () => {
    await adapter.setItem(KEY, SESSION);
    asyncStore.set('sb-other-auth-token', asyncStore.get(KEY)!);
    __resetSessionStorageForTests();

    await expect(adapter.getItem('sb-other-auth-token')).resolves.toBeNull();
  });
});

describe('round trip', () => {
  it('writes ciphertext, not the session, and reads it back', async () => {
    setSessionCipher(reversingCipher);
    await adapter.setItem(KEY, SESSION);

    const onDisk = asyncStore.get(KEY)!;
    expect(onDisk).not.toContain('refresh_token');
    expect(onDisk).toContain('test-reverse');

    __resetSessionStorageForTests();
    setSessionCipher(reversingCipher);
    expect(await adapter.getItem(KEY)).toBe(SESSION);
  });

  it('mints the key once and keeps it in SecureStore, not AsyncStorage', async () => {
    setSessionCipher(reversingCipher);
    await adapter.setItem(KEY, SESSION);

    const stored = secureStore.get(SESSION_KEY_STORE_KEY);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect([...asyncStore.values()].join()).not.toContain(stored!);
  });

  it('reports no session when the blob cannot be authenticated', async () => {
    setSessionCipher(reversingCipher);
    await adapter.setItem(KEY, SESSION);
    // A tampered key: decrypt returns null rather than throwing into auth-js.
    secureStore.set(SESSION_KEY_STORE_KEY, 'f'.repeat(64));
    __resetSessionStorageForTests();
    setSessionCipher(reversingCipher);

    expect(await adapter.getItem(KEY)).toBeNull();
  });

  it('clears the entry on removeItem', async () => {
    setSessionCipher(reversingCipher);
    await adapter.setItem(KEY, SESSION);
    await adapter.removeItem(KEY);
    expect(asyncStore.has(KEY)).toBe(false);
    expect(await adapter.getItem(KEY)).toBeNull();
  });
});

describe('plaintext migration', () => {
  it('keeps the student signed in and rewrites the plaintext entry', async () => {
    asyncStore.set(KEY, SESSION);
    setSessionCipher(reversingCipher);

    expect(await adapter.getItem(KEY)).toBe(SESSION);

    const onDisk = asyncStore.get(KEY)!;
    expect(onDisk).not.toBe(SESSION);
    expect(onDisk).not.toContain('refresh_token');

    // And it survives the next cold start.
    __resetSessionStorageForTests();
    setSessionCipher(reversingCipher);
    expect(await adapter.getItem(KEY)).toBe(SESSION);
  });

  it('turns a legacy plaintext session into real ciphertext', async () => {
    asyncStore.set(KEY, SESSION);

    expect(await adapter.getItem(KEY)).toBe(SESSION);

    const onDisk = asyncStore.get(KEY)!;
    expect(onDisk).toContain('aes-256-gcm');
    expect(onDisk).not.toContain('refresh_token');
    expect(onDisk).not.toContain('access_token');
  });

  it('refuses a plaintext-passthrough envelope instead of loading it', async () => {
    // The threat this closes: anyone with filesystem access to the handset
    // drops in `{"alg":"plaintext-passthrough","ct":"<forged session>"}` and a
    // build that honoured it would adopt that session with no key check and no
    // AAD binding at all. No shipped build ever wrote one, so there is nothing
    // to migrate — it is refused and deleted.
    asyncStore.set(
      KEY,
      JSON.stringify({ t: 'lantern-session', v: 1, alg: PASSTHROUGH_CIPHER.alg, ct: SESSION })
    );

    await expect(adapter.getItem(KEY)).resolves.toBeNull();
    expect(asyncStore.has(KEY)).toBe(false);
  });

  it('refuses the passthrough double outside a debug build', () => {
    const env = process.env as Record<string, string | undefined>;
    const prev = env.NODE_ENV;
    env.NODE_ENV = 'production';
    try {
      expect(() => setSessionCipher(PASSTHROUGH_CIPHER)).toThrow(/must not ship/);
      expect(() => setSessionCipher(AES_GCM_CIPHER)).not.toThrow();
    } finally {
      env.NODE_ENV = prev;
    }
  });

  it('does not sign the student out when a plaintext session cannot be migrated', async () => {
    asyncStore.set(KEY, SESSION);
    getItemAsyncImpl = async () => {
      throw new Error('keystore unavailable');
    };
    setItemAsyncImpl = async () => {
      throw new Error('keystore unavailable');
    };
    setSessionCipher(reversingCipher);

    expect(await adapter.getItem(KEY)).toBe(SESSION);
    expect(asyncStore.get(KEY)).toBe(SESSION);
  });
});

describe('the boot-freeze trap', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('gives up on a Keystore that never answers and reports no session', async () => {
    setSessionCipher(reversingCipher);
    asyncStore.set(
      KEY,
      JSON.stringify({ t: 'lantern-session', v: 1, alg: 'test-reverse', ct: 'dead:beef' })
    );
    getItemAsyncImpl = () => new Promise<string | null>(() => {});

    const pending = adapter.getItem(KEY);
    await jest.advanceTimersByTimeAsync(2_000);

    await expect(pending).resolves.toBeNull();
  });

  it('never writes a session it could not encrypt', async () => {
    setSessionCipher(reversingCipher);
    setItemAsyncImpl = () => new Promise<void>(() => {});

    // The key write gets the long budget: nothing is waiting on it, and giving
    // up early is what used to be mistaken for "there is no key".
    const pending = adapter.setItem(KEY, SESSION);
    await jest.advanceTimersByTimeAsync(9_000);
    await pending;

    expect(asyncStore.has(KEY)).toBe(false);
  });

  it('serves a session already held in memory even after the Keystore dies', async () => {
    setSessionCipher(reversingCipher);
    await adapter.setItem(KEY, SESSION);

    getItemAsyncImpl = () => new Promise<string | null>(() => {});
    await expect(adapter.getItem(KEY)).resolves.toBe(SESSION);
  });
});

/**
 * C2. A Keystore that does not answer in time is NOT "there is no key". Every
 * test here is a way the old two-valued `string | null` destroyed a real
 * student's session on a slow cold boot.
 */
describe('key custody', () => {
  /** A stored session, written under a key that really is in the Keystore. */
  async function seedStoredSession(): Promise<string> {
    setSessionCipher(reversingCipher);
    await adapter.setItem(KEY, SESSION);
    const onDisk = asyncStore.get(KEY)!;
    __resetSessionStorageForTests();
    setSessionCipher(reversingCipher);
    setItemAsyncCalls.length = 0;
    return onDisk;
  }

  it('does not mint over the real key when the first read times out, and recovers on the next one', async () => {
    jest.useFakeTimers();
    try {
      const onDisk = await seedStoredSession();
      const realKey = secureStore.get(SESSION_KEY_STORE_KEY)!;
      let hang = true;
      getItemAsyncImpl = (key) =>
        hang ? new Promise<string | null>(() => {}) : Promise.resolve(secureStore.get(key) ?? null);

      const first = adapter.getItem(KEY);
      await jest.advanceTimersByTimeAsync(2_000);
      // Boot is answered rather than blocked…
      await expect(first).resolves.toBeNull();
      // …but nothing was minted, and the ciphertext is exactly where it was.
      expect(setItemAsyncCalls).toEqual([]);
      expect(secureStore.get(SESSION_KEY_STORE_KEY)).toBe(realKey);
      expect(asyncStore.get(KEY)).toBe(onDisk);

      // The non-answer was not cached: the next access asks again, with the
      // longer budget, and the session comes back.
      hang = false;
      await expect(adapter.getItem(KEY)).resolves.toBe(SESSION);
    } finally {
      jest.useRealTimers();
    }
  });

  it('leaves the stored session alone when setItem runs while the key is unknown', async () => {
    jest.useFakeTimers();
    try {
      const onDisk = await seedStoredSession();
      getItemAsyncImpl = () => new Promise<string | null>(() => {});

      const pending = adapter.setItem(KEY, JSON.stringify({ access_token: 'refreshed' }));
      await jest.advanceTimersByTimeAsync(2_000);
      await pending;

      // The old no-key branch called AsyncStorage.removeItem here, deleting the
      // session of a student who was signed in and working.
      expect(asyncStore.get(KEY)).toBe(onDisk);
      expect(setItemAsyncCalls).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('defers removeItem while the key is unknown and replays it once custody resolves', async () => {
    jest.useFakeTimers();
    try {
      const onDisk = await seedStoredSession();
      let hang = true;
      getItemAsyncImpl = (key) =>
        hang ? new Promise<string | null>(() => {}) : Promise.resolve(secureStore.get(key) ?? null);

      // auth-js calls removeItem whenever getItem comes back empty.
      await adapter.removeItem(KEY);
      await jest.advanceTimersByTimeAsync(2_000);
      expect(asyncStore.get(KEY)).toBe(onDisk);

      // The Keystore settles; the background retry resolves custody and the
      // deferred delete is replayed, so a real sign-out still sticks.
      hang = false;
      await jest.advanceTimersByTimeAsync(4_000);
      expect(asyncStore.has(KEY)).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('clears a session whose key is genuinely gone, and says why', async () => {
    await seedStoredSession();
    // The restored-backup case: AsyncStorage came back, the Keystore did not.
    secureStore.delete(SESSION_KEY_STORE_KEY);

    await expect(adapter.getItem(KEY)).resolves.toBeNull();
    expect(asyncStore.has(KEY)).toBe(false);
    expect((console.warn as jest.Mock).mock.calls.flat().join(' ')).toContain(
      'the session key is gone from SecureStore'
    );
  });

  it('still mints a key on a genuinely fresh install', async () => {
    setSessionCipher(reversingCipher);
    await adapter.setItem(KEY, SESSION);

    expect(setItemAsyncCalls).toEqual([SESSION_KEY_STORE_KEY]);
    expect(secureStore.get(SESSION_KEY_STORE_KEY)).toMatch(/^[0-9a-f]{64}$/);
    expect(asyncStore.get(KEY)).toContain('test-reverse');
  });
});
