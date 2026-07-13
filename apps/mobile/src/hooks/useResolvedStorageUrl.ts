import { useEffect, useState } from 'react';
import { resolveStorageDisplayUrl } from '../services/storageUrls';

/**
 * Resolve private storage paths (question-images, flashcard-images, …)
 * to signed URLs safe for React Native <Image>.
 */
export function useResolvedStorageUrl(src?: string | null): string | undefined {
  const [resolved, setResolved] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!src) {
      setResolved(undefined);
      return;
    }

    let cancelled = false;
    setResolved(undefined);

    void resolveStorageDisplayUrl(src)
      .then(url => {
        if (!cancelled) setResolved(url);
      })
      .catch(() => {
        if (!cancelled) setResolved(undefined);
      });

    return () => {
      cancelled = true;
    };
  }, [src]);

  return resolved;
}
