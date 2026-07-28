import {
  isPrivateStorageBucket,
  normalizeStorageUrl,
  parseStorageObjectUrl,
} from '@lantern/shared/utils/storageUrl';
import { API_BASE_URL, getAuthHeaders } from './supabase';
import {
  getCachedSignedUrl,
  setCachedSignedUrl,
  signedUrlCacheKey,
} from '../utils/signedUrlCache';

/** Mint a fresh signed read URL for a private storage object. */
export async function fetchSignedStorageUrl(
  bucket: string,
  path: string,
  expiresInSeconds = 60 * 60 * 6,
  variant: 'thumb' | 'original' = 'original',
): Promise<string> {
  const cacheKey = signedUrlCacheKey(bucket, path, variant);
  const cached = getCachedSignedUrl(cacheKey);
  if (cached) return cached;

  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE_URL}/api/v1/storage/signed-url`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucket, path, expiresInSeconds, variant }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
    data?: { signedUrl?: string };
  };
  if (!response.ok) {
    throw new Error(body.error || body.message || 'Failed to sign storage URL');
  }
  if (!body.data?.signedUrl) {
    throw new Error('Signed URL missing from response');
  }
  setCachedSignedUrl(cacheKey, body.data.signedUrl, expiresInSeconds);
  return body.data.signedUrl;
}

/**
 * Resolve a stored image URL for display.
 * Private buckets (question-images, etc.) must be re-signed; public URLs are normalized.
 */
export async function resolveStorageDisplayUrl(
  src?: string | null,
  options?: { variant?: 'thumb' | 'original' },
): Promise<string | undefined> {
  if (!src) return undefined;
  if (src.startsWith('data:') || src.startsWith('blob:')) return src;

  const parsed = parseStorageObjectUrl(src);
  if (parsed && isPrivateStorageBucket(parsed.bucket)) {
    return fetchSignedStorageUrl(
      parsed.bucket,
      parsed.path,
      60 * 60 * 6,
      options?.variant || 'original',
    );
  }

  return normalizeStorageUrl(src);
}
