/**
 * Supabase auth storage backed by expo-secure-store (chunked for large sessions).
 */
import * as SecureStore from 'expo-secure-store';

const CHUNK_SIZE = 2000;

// expo-secure-store talks to the Android Keystore / iOS Keychain natively. On some
// environments (notably Expo Go on preview Android system images) that native call can
// hang indefinitely, which would otherwise wedge Supabase auth init and freeze app boot.
// Guard every call with a timeout so a stuck keystore degrades to "no persisted session"
// (user signs in again) instead of bricking startup. On healthy devices this never fires.
const STORE_OP_TIMEOUT_MS = 3000;

function withTimeout<T>(op: Promise<T>, fallback: T, label: string): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn(`[secureStorage] ${label} timed out after ${STORE_OP_TIMEOUT_MS}ms; using fallback`);
      resolve(fallback);
    }, STORE_OP_TIMEOUT_MS);
    op.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        console.warn(`[secureStorage] ${label} failed; using fallback`, err);
        resolve(fallback);
      }
    );
  });
}

const getItemSafe = (key: string) =>
  withTimeout<string | null>(SecureStore.getItemAsync(key), null, `getItemAsync(${key})`);
const setItemSafe = (key: string, value: string) =>
  withTimeout<void>(SecureStore.setItemAsync(key, value), undefined, `setItemAsync(${key})`);
const deleteItemSafe = (key: string) =>
  withTimeout<void>(SecureStore.deleteItemAsync(key), undefined, `deleteItemAsync(${key})`);

async function getChunkCount(key: string): Promise<number | null> {
  const countRaw = await getItemSafe(`${key}_count`);
  if (!countRaw) return null;
  const count = parseInt(countRaw, 10);
  return Number.isFinite(count) && count > 0 ? count : null;
}

// In-memory write-through layer. The Keychain/Keystore is flaky under timeout
// pressure (a slow read degrades to "no session", which cascades into 401s and
// silent logouts — the exact iOS incident of Aug 10). Values written or read
// once in this app run are served from memory thereafter, so a later Keychain
// hiccup cannot lose a session the app already holds. Memory never outlives
// the process, so this changes durability semantics only in the failure case.
const memoryCache = new Map<string, string | null>();

export const ExpoSecureStoreAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    if (memoryCache.has(key)) return memoryCache.get(key) ?? null;
    const chunkCount = await getChunkCount(key);
    let value: string | null;
    if (chunkCount) {
      const parts: string[] = [];
      let complete = true;
      for (let i = 0; i < chunkCount; i += 1) {
        const part = await getItemSafe(`${key}_${i}`);
        if (part == null) {
          complete = false;
          break;
        }
        parts.push(part);
      }
      value = complete ? parts.join('') : null;
    } else {
      value = await getItemSafe(key);
    }
    // Cache hits AND misses: a miss cached here is overwritten by the next
    // setItem, while an uncached miss would re-hit a possibly-hung Keystore on
    // every getSession() call.
    memoryCache.set(key, value);
    return value;
  },
  setItem: async (key: string, value: string): Promise<void> => {
    memoryCache.set(key, value);
    await deleteItemSafe(`${key}_count`);
    for (let i = 0; i < 32; i += 1) {
      await deleteItemSafe(`${key}_${i}`);
    }

    if (value.length <= CHUNK_SIZE) {
      await setItemSafe(key, value);
      return;
    }

    const chunkCount = Math.ceil(value.length / CHUNK_SIZE);
    for (let i = 0; i < chunkCount; i += 1) {
      await setItemSafe(`${key}_${i}`, value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
    }
    await setItemSafe(`${key}_count`, String(chunkCount));
    await deleteItemSafe(key);
  },
  removeItem: async (key: string): Promise<void> => {
    memoryCache.set(key, null);
    const chunkCount = await getChunkCount(key);
    if (chunkCount) {
      for (let i = 0; i < chunkCount; i += 1) {
        await deleteItemSafe(`${key}_${i}`);
      }
      await deleteItemSafe(`${key}_count`);
    }
    await deleteItemSafe(key);
  },
};
