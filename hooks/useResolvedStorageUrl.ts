import { useEffect, useState } from 'react';
import {
  isPrivateStorageBucket,
  normalizeStorageUrl,
  parseStorageObjectUrl,
} from '@lantern/shared/utils/storageUrl';
import { fetchSignedStorageUrl } from '../services/supabase';

/**
 * Resolve private storage paths to signed URLs for <img> display.
 * Optional variant prefers upload-time sibling thumbs when available.
 */
export function useResolvedStorageUrl(
  src?: string | null,
  options?: { variant?: 'thumb' | 'original'; expiresInSeconds?: number },
): string | undefined {
  const [resolved, setResolved] = useState<string | undefined>(undefined);
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

    const parsed = parseStorageObjectUrl(src);
    if (parsed && isPrivateStorageBucket(parsed.bucket)) {
      let cancelled = false;
      fetchSignedStorageUrl(parsed.bucket, parsed.path, expiresInSeconds, variant)
        .then((signed) => {
          if (!cancelled) setResolved(signed);
        })
        .catch(() => {
          if (!cancelled) setResolved(undefined);
        });
      return () => {
        cancelled = true;
      };
    }

    setResolved(normalizeStorageUrl(src));
  }, [src, variant, expiresInSeconds]);

  return resolved;
}
