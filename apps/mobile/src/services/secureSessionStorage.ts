/**
 * Supabase auth storage for Android: AsyncStorage for speed, encrypted at rest.
 *
 * WHY THIS FILE EXISTS
 * The session (access token AND the long-lived refresh token) used to sit in
 * AsyncStorage as plaintext JSON — `databases/RKStorage`, readable on a rooted
 * or forensically accessible handset, which is indefinite account takeover that
 * survives a password change. The obvious fix (put the session in
 * expo-secure-store, as iOS does) is the one thing this app may NOT do:
 *
 * BOOT-FREEZE TRAP — DO NOT MAKE SESSION READS DEPEND ON A BLOCKING KEYSTORE CALL.
 * On a preview Android system image under Expo Go, a raw
 * `SecureStore.getItemAsync` never resolved: the native Keystore JSI call
 * wedged, supabase-js's auth init awaited it forever, and the splash screen
 * hung with no watchdog able to fire (the JS thread was gone). That is the
 * documented reason Android auth storage is AsyncStorage at all.
 *
 * So the split here is deliberate:
 *   - the SESSION stays in AsyncStorage, which is a fast, reliable, non-blocking
 *     read on the boot path;
 *   - only a 256-bit KEY lives in SecureStore, is read LAZILY (never at module
 *     load), behind `SECURE_STORE_TIMEOUT_MS`;
 *   - a Keystore that hangs or throws degrades to "there is no stored session"
 *     FOR THIS READ. It NEVER blocks boot and never throws into auth-js.
 * Anything added to this file must keep those three properties.
 *
 * KEY-CUSTODY TRAP — A TIMEOUT IS NOT "NO KEY". (fix G2)
 * The first version of this file collapsed "SecureStore answered null" and
 * "SecureStore did not answer in 1.5 s" into the same `null`, so a slow cold
 * boot MINTED A FRESH KEY OVER THE REAL ONE and every stored session became
 * permanently undecryptable; the null was then memoised for the process, so the
 * next token refresh took `setItem`'s no-key branch and DELETED the session of a
 * student who was signed in and working. Custody is therefore three-valued:
 *
 *   present  SecureStore returned key bytes.            → decrypt / encrypt.
 *   absent   SecureStore positively returned null.      → the ONLY state that
 *            may mint a key; an existing envelope is then unopenable forever
 *            (device restore, cleared keystore) and is cleared, with a reason.
 *   unknown  the call timed out or threw.               → this boot reports "no
 *            session", the ciphertext on disk is LEFT ALONE, nothing is minted,
 *            the null is NOT cached, and the read is retried on the next access
 *            with a longer budget (and once in the background after boot).
 *
 * `absent` is confirmed by a second read before anything destructive happens.
 *
 * THE DELETE RULE — A REMOVE MUST NOT ECHO OUR OWN "NO SESSION".
 * auth-js calls `removeItem` as part of giving up on a session, so the
 * `getItem` that answers "none" because custody was `unknown` is followed
 * within milliseconds by a `removeItem` for a session that is intact on disk.
 * A first cut of this file deferred that delete and replayed it once custody
 * resolved, which destroyed the session a beat later instead of at once — the
 * 1.0.61 smoke ("signed out on first launch and every launch after"). A delete
 * is therefore honoured only for an entry whose value this process actually saw
 * (`observedEntries`): a read-back session or one handed to `setItem` means the
 * student really was signed in here, so a later removal is a real sign-out.
 * Nothing else may delete. `setItem` with no key likewise keeps the value in
 * memory only and leaves the disk untouched.
 *
 * The cipher is AES-256-GCM from `@noble/ciphers` — pure JS and audited, so it
 * needs no native module, no rebuild and stays OTA-safe (React Native has no
 * SubtleCrypto and `expo-crypto` provides digests and a CSPRNG but no AES).
 * The 96-bit nonce is fresh per write, from the same CSPRNG that mints the key,
 * and the AAD is the STORAGE KEY NAME, so a ciphertext lifted out of one entry
 * fails authentication in another rather than decrypting there.
 *
 * Main exports: `EncryptedSessionStorageAdapter` (the supabase-js
 * `SupportedStorage` shape), `SessionCipher`, `AES_GCM_CIPHER`,
 * `setSessionCipher`, `SESSION_KEY_STORE_KEY`.
 *
 * Touches: @react-native-async-storage/async-storage (the session bytes),
 * expo-secure-store (the key only), expo-crypto (key + nonce generation),
 * @noble/ciphers (AES-256-GCM).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { gcm } from '@noble/ciphers/aes.js';
import { bytesToHex, bytesToUtf8, hexToBytes, utf8ToBytes } from '@noble/ciphers/utils.js';

/**
 * Pluggable content cipher. String in, string out: the cipher owns its own
 * encoding (base64, hex, whatever) so this file never needs a base64 polyfill,
 * which React Native does not reliably provide.
 *
 * `decrypt` returns null for anything it cannot authenticate — a wrong key, a
 * truncated write, a tampered blob. Null means "no stored session", never an
 * exception: auth-js calls `getItem` during its own init and a throw there is
 * the boot hang all over again.
 */
export interface SessionCipher {
  /** Stamped into the envelope, so a blob written by one cipher is never fed to another. */
  readonly alg: string;
  /** `aad` is the storage key name: it binds a ciphertext to the entry it was written for. */
  encrypt(plaintext: string, keyHex: string, aad: string): Promise<string>;
  decrypt(ciphertext: string, keyHex: string, aad: string): Promise<string | null>;
}

const NONCE_BYTES = 12;

/**
 * AES-256-GCM. The payload is `<nonce hex>.<ciphertext+tag hex>` — hex rather
 * than base64 because React Native does not reliably provide `btoa`/`atob`, and
 * noble ships the codec anyway.
 *
 * `decrypt` returns null for every failure, including a failed tag check. GCM
 * throws on tampering, and that throw must not escape into auth-js's own init —
 * a corrupt entry is "no stored session", which routes to sign-in.
 */
export const AES_GCM_CIPHER: SessionCipher = {
  alg: 'aes-256-gcm',
  async encrypt(plaintext: string, keyHex: string, aad: string): Promise<string> {
    const nonce = await Crypto.getRandomBytesAsync(NONCE_BYTES);
    const sealed = gcm(hexToBytes(keyHex), nonce, utf8ToBytes(aad)).encrypt(utf8ToBytes(plaintext));
    return `${bytesToHex(nonce)}.${bytesToHex(sealed)}`;
  },
  async decrypt(ciphertext: string, keyHex: string, aad: string): Promise<string | null> {
    const dot = ciphertext.indexOf('.');
    if (dot <= 0) return null;
    try {
      const nonce = hexToBytes(ciphertext.slice(0, dot));
      const sealed = hexToBytes(ciphertext.slice(dot + 1));
      if (nonce.length !== NONCE_BYTES) return null;
      return bytesToUtf8(gcm(hexToBytes(keyHex), nonce, utf8ToBytes(aad)).decrypt(sealed));
    } catch {
      return null;
    }
  },
};

/**
 * ⚠️ NOT ENCRYPTION — a test double only. It exists so the adapter's own
 * behaviour (key custody, timeouts, migration) can be exercised without the
 * cipher in the way, and so the envelope written by the pre-AES build can still
 * be read and upgraded. `setSessionCipher` refuses it outside a debug build.
 */
export const PASSTHROUGH_CIPHER: SessionCipher = {
  alg: 'plaintext-passthrough',
  async encrypt(plaintext: string): Promise<string> {
    return plaintext;
  },
  async decrypt(ciphertext: string): Promise<string | null> {
    return ciphertext;
  },
};

function isDebugBuild(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__ === true;
}

let activeCipher: SessionCipher = AES_GCM_CIPHER;

/**
 * Swap the cipher. Guarded rather than free: the passthrough is a test double,
 * and a release build reaching for it would silently put every student's
 * refresh token back on disk in the clear.
 */
export function setSessionCipher(cipher: SessionCipher): void {
  assertShippableCipher(cipher);
  activeCipher = cipher;
}

/**
 * `__DEV__` is undefined under ts-jest (node, no React Native globals), so the
 * NODE_ENV clause is what lets the suite exercise the passthrough double. In a
 * release bundle NODE_ENV is 'production' and `__DEV__` is false, so both
 * clauses fail and the throw stands.
 */
function assertShippableCipher(cipher: SessionCipher): void {
  if (cipher.alg === PASSTHROUGH_CIPHER.alg && !isDebugBuild() && process.env.NODE_ENV !== 'test') {
    throw new Error('[sessionStorage] the passthrough cipher is a test double and must not ship');
  }
}

// Module init: whatever a future edit makes the default, a release build may not
// boot with a cipher that does not encrypt.
assertShippableCipher(activeCipher);

export function getSessionCipher(): SessionCipher {
  return activeCipher;
}

// ─── The key ────────────────────────────────────────────────────────────────

/** SecureStore entry holding the hex-encoded 256-bit content key. */
export const SESSION_KEY_STORE_KEY = 'lantern.auth.session-key.v1';

const KEY_BYTES = 32;

/**
 * Deliberately short on the boot path: this is the only Keystore call boot
 * waits on, and reporting "no session for now" is far cheaper than a frozen
 * splash. A healthy device answers in single-digit milliseconds.
 */
const SECURE_STORE_TIMEOUT_MS = 1_500;

/**
 * Every attempt AFTER the first. Nothing is waiting on these — boot has already
 * been answered — so they may take as long as a struggling Keystore needs. The
 * whole point of the retry is to find the real key instead of concluding there
 * is none.
 */
const SECURE_STORE_RETRY_TIMEOUT_MS = 8_000;

/** How long after a failed first read to try again unprompted. */
const BACKGROUND_KEY_RETRY_MS = 3_000;

/**
 * `{ ok: true }` only when the operation itself answered. `ok: false` is
 * "no answer" — a timeout or a throw — and callers MUST NOT read that as a
 * result: it is the difference between "there is no key" and "we could not ask".
 */
type Settled<T> = { ok: true; value: T } | { ok: false };

function withTimeout<T>(
  op: () => Promise<T>,
  label: string,
  timeoutMs: number
): Promise<Settled<T>> {
  return new Promise<Settled<T>>((resolve) => {
    let settled = false;
    const settle = (outcome: Settled<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn(
        `[sessionStorage] ${label} did not answer within ${timeoutMs}ms; this is NOT a result and nothing on disk is touched`
      );
      resolve({ ok: false });
    }, timeoutMs);
    let promise: Promise<T>;
    try {
      promise = op();
    } catch (err) {
      console.warn(`[sessionStorage] ${label} threw synchronously`, err);
      settle({ ok: false });
      return;
    }
    promise.then(
      (value) => settle({ ok: true, value }),
      (err) => {
        console.warn(`[sessionStorage] ${label} failed`, err);
        settle({ ok: false });
      }
    );
  });
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * What SecureStore told us about the key — see the KEY-CUSTODY TRAP note at the
 * top of the file. `unknown` is a non-answer, never a "no".
 */
export type KeyCustody =
  | { status: 'present'; keyHex: string }
  | { status: 'absent' }
  | { status: 'unknown' };

const CUSTODY_UNKNOWN: KeyCustody = { status: 'unknown' };

/** Only ever `present` or `absent`: a non-answer is never cached. */
let resolvedCustody: KeyCustody | null = null;
/** One in-flight read per process; a second caller awaits the first. */
let custodyPromise: Promise<KeyCustody> | null = null;
let custodyAttempts = 0;
let backgroundRetryTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Entries whose VALUE this process has actually seen — read back non-null, or
 * handed to us by `setItem`.
 *
 * This is the whole of the delete rule, and it is load-bearing. auth-js calls
 * `removeItem` as part of giving up on a session, so a `getItem` that answered
 * "none" only because the Keystore was slow is immediately followed by a
 * `removeItem` for a session that is perfectly intact on disk. A delete is
 * therefore honoured ONLY for an entry this process has proof of: reading or
 * writing a value means the student really was signed in here, so a later
 * removal is a real sign-out. A removal for an entry we never saw is dropped —
 * it can only be the echo of our own "no session" answer.
 */
const observedEntries = new Set<string>();

/** One line per storage key per process, so a release build is not silent. */
const diagnosed = new Set<string>();

/**
 * Release builds keep `console.warn` (verified in the 1.0.61 logcat), so this
 * is the one trace that survives to a device smoke. It fires once per key.
 */
function diagnose(key: string, outcome: string): void {
  if (diagnosed.has(key)) return;
  diagnosed.add(key);
  console.warn(`[sessionStorage] first read of ${key}: ${outcome}`);
}

/** A single read. Never mints — minting is `mintSessionKey`, and only on `absent`. */
async function readKeyCustody(timeoutMs: number): Promise<KeyCustody> {
  const read = await withTimeout<string | null>(
    () => SecureStore.getItemAsync(SESSION_KEY_STORE_KEY),
    'getItemAsync(session key)',
    timeoutMs
  );
  if (!read.ok) return CUSTODY_UNKNOWN;
  const value = read.value;
  if (value && value.length >= KEY_BYTES * 2) return { status: 'present', keyHex: value };
  // A positive null (or a truncated entry that can decrypt nothing): there is
  // genuinely no usable key in the Keystore.
  return { status: 'absent' };
}

/**
 * Custody for this process. The first call gets the short boot budget; every
 * later call, and the background retry, gets the long one. A `present`/`absent`
 * answer is memoised; `unknown` is deliberately not, so the next access asks
 * again instead of inheriting a non-answer.
 */
function sessionKeyCustody(): Promise<KeyCustody> {
  if (resolvedCustody) return Promise.resolve(resolvedCustody);
  if (custodyPromise) return custodyPromise;

  const timeoutMs = custodyAttempts === 0 ? SECURE_STORE_TIMEOUT_MS : SECURE_STORE_RETRY_TIMEOUT_MS;
  custodyAttempts += 1;
  const attempt = readKeyCustody(timeoutMs)
    .then(async (first) => {
      // `absent` is the only answer that authorises minting a key or clearing a
      // stored session, so it is never taken on one reading. The confirmation
      // keeps the short budget: a Keystore that just answered is answering, and
      // boot must still be bounded (worst case 2 × 1.5 s, and a confirm that
      // does not come back leaves custody `unknown`, which destroys nothing).
      if (first.status !== 'absent') return first;
      return readKeyCustody(SECURE_STORE_TIMEOUT_MS);
    })
    .then((custody) => {
      custodyPromise = null;
      if (custody.status === 'unknown') {
        scheduleBackgroundKeyRetry();
        return custody;
      }
      resolvedCustody = custody;
      return custody;
    });
  custodyPromise = attempt;
  return attempt;
}

/**
 * One unprompted retry after boot, so a handset whose Keystore was merely slow
 * gets its sessions back without the student having to touch anything. It is a
 * single timer, it is never awaited, and it cannot throw.
 */
function scheduleBackgroundKeyRetry(): void {
  if (backgroundRetryTimer || resolvedCustody) return;
  backgroundRetryTimer = setTimeout(() => {
    backgroundRetryTimer = null;
    if (resolvedCustody) return;
    void sessionKeyCustody().catch(() => {});
  }, BACKGROUND_KEY_RETRY_MS);
  // Never hold a node/jest process open for this.
  (backgroundRetryTimer as unknown as { unref?: () => void }).unref?.();
}

/**
 * Mint a key. ONLY legal when SecureStore positively answered `absent`: minting
 * over a key we merely failed to read is what made every stored session
 * undecryptable (C2).
 */
async function mintSessionKey(): Promise<string | null> {
  let fresh: string;
  try {
    fresh = toHex(await Crypto.getRandomBytesAsync(KEY_BYTES));
  } catch (err) {
    console.warn('[sessionStorage] could not generate a session key', err);
    return null;
  }

  const stored = await withTimeout<void>(
    () => SecureStore.setItemAsync(SESSION_KEY_STORE_KEY, fresh),
    'setItemAsync(session key)',
    SECURE_STORE_RETRY_TIMEOUT_MS
  );
  if (!stored.ok) {
    // A key we could not confirm persisting would decrypt nothing after a
    // restart. The write may still have landed, so drop the cached custody and
    // let the next access re-read rather than minting a second key.
    resolvedCustody = null;
    console.warn('[sessionStorage] could not persist a new session key; nothing is written to disk');
    return null;
  }
  resolvedCustody = { status: 'present', keyHex: fresh };
  return fresh;
}

/**
 * The key to WRITE under, or null when there is none to be had right now.
 * Never blocks boot: reads go through `sessionKeyCustody` directly so they can
 * tell `absent` from `unknown`.
 */
async function writableSessionKey(): Promise<string | null> {
  const custody = await sessionKeyCustody();
  if (custody.status === 'present') return custody.keyHex;
  if (custody.status === 'unknown') return null;
  return mintSessionKey();
}

// ─── The envelope ───────────────────────────────────────────────────────────

const ENVELOPE_VERSION = 1;
const ENVELOPE_TAG = 'lantern-session';

interface SessionEnvelope {
  t: typeof ENVELOPE_TAG;
  v: number;
  alg: string;
  ct: string;
}

function isEnvelope(value: unknown): value is SessionEnvelope {
  if (!value || typeof value !== 'object') return false;
  const env = value as Partial<SessionEnvelope>;
  return env.t === ENVELOPE_TAG && typeof env.alg === 'string' && typeof env.ct === 'string';
}

/** An envelope, or null when `raw` is a legacy plaintext session. */
function parseEnvelope(raw: string): SessionEnvelope | null {
  // Cheap reject before JSON.parse: a session blob is tens of KB and is parsed
  // on every getSession().
  if (!raw.includes(ENVELOPE_TAG)) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isEnvelope(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * `storageKey` is both where the blob goes and the AAD it is bound to: an
 * envelope copied into another entry no longer authenticates.
 */
async function wrap(plaintext: string, keyHex: string, storageKey: string): Promise<string> {
  const cipher = activeCipher;
  const envelope: SessionEnvelope = {
    t: ENVELOPE_TAG,
    v: ENVELOPE_VERSION,
    alg: cipher.alg,
    ct: await cipher.encrypt(plaintext, keyHex, storageKey),
  };
  return JSON.stringify(envelope);
}

// ─── The adapter ────────────────────────────────────────────────────────────

/**
 * Write-through memory cache. A value this process has already read or written
 * is served from memory, so a Keystore that goes bad mid-session cannot lose a
 * session the app is actively using. Memory never outlives the process, so this
 * changes durability only in the failure case. Misses are cached too.
 */
const memoryCache = new Map<string, string | null>();

export const EncryptedSessionStorageAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    if (memoryCache.has(key)) return memoryCache.get(key) ?? null;

    let raw: string | null = null;
    try {
      raw = await AsyncStorage.getItem(key);
    } catch (err) {
      console.warn('[sessionStorage] could not read the stored session', err);
      return null;
    }
    if (!raw) {
      diagnose(key, 'nothing stored');
      memoryCache.set(key, null);
      return null;
    }

    const envelope = parseEnvelope(raw);

    // Legacy plaintext session written before this adapter existed (pre-F45).
    // Still needed: those entries are on fielded handsets. Keep the student
    // signed in, then re-write it through the cipher — which overwrites the same
    // AsyncStorage entry, so the plaintext copy is gone afterwards.
    if (!envelope) {
      const keyHex = await writableSessionKey();
      if (keyHex) {
        try {
          await AsyncStorage.setItem(key, await wrap(raw, keyHex, key));
          diagnose(key, 'legacy plaintext session, migrated to ciphertext');
        } catch (err) {
          diagnose(key, 'legacy plaintext session, migration write failed');
          console.warn('[sessionStorage] could not migrate the plaintext session', err);
        }
      } else {
        diagnose(key, 'legacy plaintext session, kept as-is (no key yet)');
        console.warn('[sessionStorage] no key available; the stored session stays in plaintext for now');
      }
      observedEntries.add(key);
      memoryCache.set(key, raw);
      return raw;
    }

    // An envelope this build cannot open is not an error the user can act on:
    // report "no session" and let them sign in again. There is deliberately no
    // exception for the `plaintext-passthrough` envelope — accepting one meant a
    // release build would load a session with no key and no AAD check, and the
    // builds that could have written one never shipped (M6).
    if (envelope.alg !== activeCipher.alg) {
      diagnose(key, `envelope uses ${envelope.alg}, which this build cannot read`);
      console.warn(`[sessionStorage] stored session uses ${envelope.alg}; this build cannot read it`);
      memoryCache.set(key, null);
      return null;
    }

    const custody = await sessionKeyCustody();

    if (custody.status === 'unknown') {
      // The Keystore hung or refused — we do NOT know there is no key. Report
      // "no session" so boot is never blocked, leave the ciphertext exactly
      // where it is, and do NOT cache this miss: the next access re-asks with a
      // longer budget, and a background retry is already scheduled. `key` is
      // deliberately NOT added to `observedEntries`, so the `removeItem` auth-js
      // fires on the back of this answer cannot delete the session.
      diagnose(key, 'key state unknown; reporting no session and keeping the ciphertext');
      console.warn(
        '[sessionStorage] the session key could not be read; reporting no session for now and keeping the stored session intact'
      );
      return null;
    }

    if (custody.status === 'absent') {
      // SecureStore positively answered "no key", twice (the answer is
      // confirmed before anything destructive happens). The envelope on disk can
      // never be decrypted again — a restored backup, a cleared keystore, or an
      // APK signed with a different key — so it is dead weight, not a session.
      diagnose(key, 'key confirmed absent; the stored ciphertext is unopenable and is being cleared');
      console.warn(
        '[sessionStorage] the session key is gone from SecureStore (restored backup or cleared keystore); the stored session can never be decrypted and is being cleared'
      );
      memoryCache.set(key, null);
      await AsyncStorage.removeItem(key).catch(() => {});
      return null;
    }

    let plaintext: string | null;
    try {
      plaintext = await activeCipher.decrypt(envelope.ct, custody.keyHex, key);
    } catch (err) {
      console.warn('[sessionStorage] could not decrypt the stored session', err);
      plaintext = null;
    }

    diagnose(key, plaintext === null ? 'envelope did not authenticate' : 'session decrypted');
    if (plaintext !== null) observedEntries.add(key);
    memoryCache.set(key, plaintext);
    return plaintext;
  },

  setItem: async (key: string, value: string): Promise<void> => {
    memoryCache.set(key, value);
    // A value handed to us is proof the student is signed in here, so a later
    // `removeItem` for this entry is a real sign-out rather than the echo of a
    // Keystore non-answer.
    observedEntries.add(key);
    const keyHex = await writableSessionKey();
    if (!keyHex) {
      // Without a key we will not write a session we could never open again —
      // and we will not write it in the clear either. Crucially we also do NOT
      // remove what is already on disk: an unavailable Keystore must never be
      // the reason a signed-in student's session is deleted (C2). The value
      // stays in memory for this run.
      console.warn(
        '[sessionStorage] the session key is unavailable; keeping the session in memory only and leaving the stored session untouched'
      );
      return;
    }
    try {
      await AsyncStorage.setItem(key, await wrap(value, keyHex, key));
    } catch (err) {
      console.warn('[sessionStorage] could not persist the session', err);
    }
  },

  removeItem: async (key: string): Promise<void> => {
    memoryCache.set(key, null);
    // THE DELETE RULE. auth-js calls `removeItem` as part of giving up on a
    // session — including immediately after the `getItem` that answered "none"
    // because the Keystore had not come back yet. Deleting there wipes a session
    // that is perfectly intact on disk, and the student is signed out on this
    // launch and every launch after. So a delete is honoured only for an entry
    // whose value this process actually saw. Anything else is our own "no
    // session" answer coming back at us, and is dropped: the entry is treated as
    // gone for this run (the memory cache above) and left untouched on disk.
    if (!observedEntries.has(key)) {
      console.warn(
        '[sessionStorage] ignoring a delete for a session this process never read; the stored session is left on disk'
      );
      return;
    }
    try {
      await AsyncStorage.removeItem(key);
    } catch (err) {
      console.warn('[sessionStorage] could not clear the stored session', err);
    }
  },
};

/** Test seam: drops the memoised key custody and the value cache. */
export function __resetSessionStorageForTests(): void {
  resolvedCustody = null;
  custodyPromise = null;
  custodyAttempts = 0;
  if (backgroundRetryTimer) clearTimeout(backgroundRetryTimer);
  backgroundRetryTimer = null;
  observedEntries.clear();
  diagnosed.clear();
  memoryCache.clear();
  activeCipher = AES_GCM_CIPHER;
}

/** Test seam: what SecureStore last told us about the key. */
export function __sessionKeyCustodyForTests(): KeyCustody {
  return resolvedCustody ?? CUSTODY_UNKNOWN;
}
