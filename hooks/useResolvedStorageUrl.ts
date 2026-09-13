import { useEffect, useState } from 'react';
import {
  isPrivateStorageBucket,
  normalizeStorageUrl,
  parseStoredStorageRef,
} from '@lantern/shared/utils/storageUrl';
import { fetchSignedStorageUrl } from '../services/supabase';

/**
 * Resolve private storage paths to signed URLs for media display.
 * Optional variant prefers upload-time sibling thumbs when available.
 *
 * Return values:
 * - `undefined` — no src, or still loading a private object
 * - `null` — private object could not be signed / access denied
 * - `string` — playable/displayable URL
 */
export function useResolvedStorageUrl(
  src?: string | null,
  options?: { variant?: 'thumb' | 'original'; expiresInSeconds?: number },
): string | null | undefined {
  const [resolved, setResolved] = useState<string | null | undefined>(undefined);
  const variant = options?.variant || 'original';
  const expiresInSeconds = options?.expiresInSeconds ?? 60 * 60 * 6;

  useEffect(() => {
    if (!src) {
      setResolved(undefined);
      return;
    }
    if (src.startsWith('data:') || src.startsWith('blob:')) {
      setResolved(src);
      return;
    }

    const parsed = parseStoredStorageRef(src);
    if (parsed && isPrivateStorageBucket(parsed.bucket)) {
      let cancelled = false;
      setResolved(undefined);
      fetchSignedStorageUrl(parsed.bucket, parsed.path, expiresInSeconds, variant)
        .then((signed) => {
          if (!cancelled) setResolved(signed);
        })
        .catch(() => {
          if (!cancelled) setResolved(null);
        });
      return () => {
        cancelled = true;
      };
    }

    setResolved(normalizeStorageUrl(src));
  }, [src, variant, expiresInSeconds]);

  return resolved;
}
