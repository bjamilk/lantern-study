import {
  isPrivateStorageBucket,
  normalizeStorageUrl,
  parseStoredStorageRef,
} from '@lantern/shared/utils/storageUrl';
import {
  createSignedUrlBatcher,
  type SignedUrlBatchResult,
  type SignedUrlRequest,
} from '@lantern/shared/utils/signedUrlBatch';
import { API_BASE_URL, getAuthHeaders } from './supabase';
import {
  getCachedSignedUrl,
  setCachedSignedUrl,
  signedUrlCacheKey,
} from '../utils/signedUrlCache';

/**
 * How long a display URL is asked to live. The server clamps every signed URL
 * to STORAGE_SIGNED_URL_MAX_TTL (24h) — the reason a URL frozen into
 * `messages.text` at upload time is dead the next day, and why display URLs
 * are minted here on READ instead of being read back out of the row.
 */
const DEFAULT_DISPLAY_TTL_SECONDS = 60 * 60 * 6;

/**
 * Every resolve that lands in the same tick becomes ONE POST
 * /api/v1/storage/signed-urls. A board post screen mounts the root photo plus
 * one photo per comment; per-image signing would make that twenty round trips
 * on a connection the student pays for by the megabyte.
 */
const batcher = createSignedUrlBatcher({
  sign: async (items: SignedUrlRequest[], expiresInSeconds: number) => {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE_URL}/api/v1/storage/signed-urls`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: items.map(({ bucket, path, variant }) => ({ bucket, path, variant })),
        expiresInSeconds,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      data?: { items?: SignedUrlBatchResult[] };
    };
    if (!response.ok) {
      throw new Error(body.error || body.message || 'Failed to sign storage URLs');
    }
    // Positional: the route Promise.alls over `items`, so result[i] answers items[i].
    return body.data?.items ?? [];
  },
});

/** Mint a fresh signed read URL for a private storage object. */
export async function fetchSignedStorageUrl(
  bucket: string,
  path: string,
  expiresInSeconds = DEFAULT_DISPLAY_TTL_SECONDS,
  variant: 'thumb' | 'original' = 'original',
): Promise<string> {
  const cacheKey = signedUrlCacheKey(bucket, path, variant);
  const cached = getCachedSignedUrl(cacheKey);
  // The cache expires a minute EARLY (signedUrlCache SKEW_MS), so a URL handed
  // to <Image> is never one that dies mid-load.
  if (cached) return cached;

  const signedUrl = await batcher.request({ bucket, path, variant }, expiresInSeconds);
  setCachedSignedUrl(cacheKey, signedUrl, expiresInSeconds);
  return signedUrl;
}

/**
 * Resolve a stored image URL for display.
 * Private buckets (question-images, note-files, …) must be re-signed; public
 * URLs are normalized.
 */
export async function resolveStorageDisplayUrl(
  src?: string | null,
  options?: { variant?: 'thumb' | 'original' },
): Promise<string | undefined> {
  if (!src) return undefined;
  if (src.startsWith('data:') || src.startsWith('blob:')) return src;

  // `parseStorageObjectUrl` strips the `sign/` prefix and the query, so an
  // EXPIRED signed URL still yields {bucket, path} and gets re-authorised
  // through the same canAccessStorageObject. That is the whole fix: the stored
  // string is a reference, never the thing we hand to <Image>.
  const parsed = parseStoredStorageRef(src);
  if (parsed && isPrivateStorageBucket(parsed.bucket)) {
    return fetchSignedStorageUrl(
      parsed.bucket,
      parsed.path,
      DEFAULT_DISPLAY_TTL_SECONDS,
      options?.variant || 'original',
    );
  }

  return normalizeStorageUrl(src);
}
