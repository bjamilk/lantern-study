import { useEffect, useState } from 'react';
import { resolveStorageDisplayUrl } from '../services/storageUrls';

/**
 * Resolve private storage paths (question-images, flashcard-images, …)
 * to signed URLs safe for React Native Image / Audio.
 *
 * `undefined` = loading / no src; `null` = failed; `string` = ready.
 */
export function useResolvedStorageUrl(
  src?: string | null,
  options?: { variant?: 'thumb' | 'original' },
): string | null | undefined {
  const [resolved, setResolved] = useState<string | null | undefined>(undefined);
  const variant = options?.variant || 'original';

  useEffect(() => {
    if (!src) {
      setResolved(undefined);
      return;
    }

    let cancelled = false;
    setResolved(undefined);

    void resolveStorageDisplayUrl(src, { variant })
      .then(url => {
        if (!cancelled) setResolved(url ?? null);
      })
      .catch(() => {
        if (!cancelled) setResolved(null);
      });

    return () => {
      cancelled = true;
    };
  }, [src, variant]);

  return resolved;
}
