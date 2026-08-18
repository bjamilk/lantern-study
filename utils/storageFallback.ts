/**
 * Guarantees window.localStorage/sessionStorage are usable before any other
 * module touches them.
 *
 * Embedded webviews (links opened inside WhatsApp, Instagram or Facebook) and
 * browsers set to block all site data expose `window.localStorage` as null, or
 * throw on the property access itself. The app reads storage in ~100 places and
 * the earliest is index.tsx's theme lookup, which runs before React mounts — so
 * there it is not a degraded feature, it is a blank page. The usual
 * `typeof localStorage !== 'undefined'` check does not help: `typeof null` is
 * "object", so it passes and the next line throws.
 *
 * Where real storage is unusable we install an in-memory stand-in with the same
 * API: the session works normally and is forgotten on reload, which is what a
 * privacy-restricted browser implies anyway.
 */

function createMemoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
    getItem(key: string) {
      const value = entries.get(String(key));
      return value === undefined ? null : value;
    },
    key(index: number) {
      return Array.from(entries.keys())[index] ?? null;
    },
    removeItem(key: string) {
      entries.delete(String(key));
    },
    setItem(key: string, value: string) {
      entries.set(String(key), String(value));
    },
  } as Storage;
}

/** Writable, not merely present — old Safari private mode throws only on write. */
function isUsable(storage: Storage | null): storage is Storage {
  if (!storage) return false;
  try {
    const probe = '__lantern_storage_probe__';
    storage.setItem(probe, probe);
    storage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function readExisting(storage: Storage | null): Array<[string, string]> {
  if (!storage) return [];
  try {
    const copied: Array<[string, string]> = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key === null) continue;
      const value = storage.getItem(key);
      if (value !== null) copied.push([key, value]);
    }
    return copied;
  } catch {
    return [];
  }
}

function installFallback(name: 'localStorage' | 'sessionStorage'): void {
  let existing: Storage | null = null;
  try {
    existing = window[name];
  } catch {
    // Reading the property throws outright in some restricted webviews.
    existing = null;
  }

  if (isUsable(existing)) return;

  const fallback = createMemoryStorage();
  // A store can be readable but not writable. Carrying its contents over keeps
  // the signed-in session alive instead of silently logging the user out.
  for (const [key, value] of readExisting(existing)) {
    fallback.setItem(key, value);
  }

  try {
    Object.defineProperty(window, name, { configurable: true, value: fallback });
  } catch {
    // Non-configurable in this browser; call sites that guard still work.
  }
}

export function installStorageFallback(): void {
  if (typeof window === 'undefined') return;
  installFallback('localStorage');
  installFallback('sessionStorage');
}

// Runs on import, not from a caller in some entry file's body: ES module
// imports are hoisted, so every other module in the graph is evaluated before
// the first line of the entry body. Import order is the only ordering we get,
// so this module must be imported first and do its work immediately.
installStorageFallback();
