import { useEffect, useState } from 'react';
import { isPrivateStorageBucket, normalizeStorageUrl, parseStorageObjectUrl } from '@lantern/shared/utils/storageUrl';
import { fetchSignedStorageUrl } from '../services/supabase';

/** Resolve private storage avatar paths to signed URLs for display. */
export function useResolvedAvatarSrc(src?: string | null): string | undefined {
  const [resolved, setResolved] = useState<string | undefined>(undefined);

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
      fetchSignedStorageUrl(parsed.bucket, parsed.path, 60 * 60 * 6)
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
  }, [src]);

  return resolved;
}
