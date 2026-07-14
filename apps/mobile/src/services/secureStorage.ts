/**
 * Supabase auth storage backed by expo-secure-store (chunked for large sessions).
 */
import * as SecureStore from 'expo-secure-store';

const CHUNK_SIZE = 2000;
/** Android Keystore reads can stall; never block app boot forever. */
const SECURE_STORE_TIMEOUT_MS = 3_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`[SecureStore] ${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function getChunkCount(key: string): Promise<number | null> {
  const countRaw = await withTimeout(
    SecureStore.getItemAsync(`${key}_count`),
    SECURE_STORE_TIMEOUT_MS,
    `getItem(${key}_count)`
  );
  if (!countRaw) return null;
  const count = parseInt(countRaw, 10);
  return Number.isFinite(count) && count > 0 ? count : null;
}

export const ExpoSecureStoreAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      const chunkCount = await getChunkCount(key);
      if (chunkCount) {
        const parts: string[] = [];
        for (let i = 0; i < chunkCount; i += 1) {
          const part = await withTimeout(
            SecureStore.getItemAsync(`${key}_${i}`),
            SECURE_STORE_TIMEOUT_MS,
            `getItem(${key}_${i})`
          );
          if (part == null) return null;
          parts.push(part);
        }
        return parts.join('');
      }
      return await withTimeout(
        SecureStore.getItemAsync(key),
        SECURE_STORE_TIMEOUT_MS,
        `getItem(${key})`
      );
    } catch (error) {
      console.warn('[SecureStore] getItem failed; treating as empty session:', error);
      return null;
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    await SecureStore.deleteItemAsync(`${key}_count`).catch(() => {});
    for (let i = 0; i < 32; i += 1) {
      await SecureStore.deleteItemAsync(`${key}_${i}`).catch(() => {});
    }

    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value);
      return;
    }

    const chunkCount = Math.ceil(value.length / CHUNK_SIZE);
    for (let i = 0; i < chunkCount; i += 1) {
      await SecureStore.setItemAsync(`${key}_${i}`, value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
    }
    await SecureStore.setItemAsync(`${key}_count`, String(chunkCount));
    await SecureStore.deleteItemAsync(key).catch(() => {});
  },
  removeItem: async (key: string): Promise<void> => {
    try {
      const chunkCount = await getChunkCount(key);
      if (chunkCount) {
        for (let i = 0; i < chunkCount; i += 1) {
          await SecureStore.deleteItemAsync(`${key}_${i}`).catch(() => {});
        }
        await SecureStore.deleteItemAsync(`${key}_count`).catch(() => {});
      }
    } catch {
      // Best-effort cleanup
    }
    await SecureStore.deleteItemAsync(key).catch(() => {});
  },
};
