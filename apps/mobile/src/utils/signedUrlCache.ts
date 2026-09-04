/** In-memory signed URL cache keyed by bucket/path/variant. */

type CacheEntry = {
  signedUrl: string;
  expiresAtMs: number;
};

const cache = new Map<string, CacheEntry>();

/** Refresh a bit before the server TTL so clients never use an expired URL. */
const SKEW_MS = 60_000;

export function signedUrlCacheKey(
  bucket: string,
  path: string,
  variant: 'thumb' | 'original' = 'original',
): string {
  return `${bucket}:${path}:${variant}`;
}

export function getCachedSignedUrl(key: string): string | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAtMs) {
    cache.delete(key);
    return null;
  }
  return entry.signedUrl;
}

export function setCachedSignedUrl(
  key: string,
  signedUrl: string,
  expiresInSeconds: number,
): void {
  const ttlMs = Math.max(0, expiresInSeconds * 1000 - SKEW_MS);
  cache.set(key, {
    signedUrl,
    expiresAtMs: Date.now() + ttlMs,
  });
}

/**
 * Drop every cached signed URL.
 *
 * Called from `authStore.signOut` — the key is (bucket, path, variant) and says
 * nothing about whose session minted the URL, so on a shared handset the next
 * account would otherwise be handed URLs authorised for the previous student —
 * and by tests that need a cold cache.
 */
export function clearSignedUrlCache(): void {
  cache.clear();
}
