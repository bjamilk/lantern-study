import { useEffect, useState } from 'react';
import { resolveCoverDisplayUrl, resolveStorageDisplayUrl } from '../services/storageUrls';

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

/**
 * The same, for a deck / note / study-set `coverPath`.
 *
 * Covers are stored as a BARE object path with no bucket segment, which the
 * generic resolver cannot parse — see `parseCoverStorageRef`. This hook signs
 * them against `cover-images`, and still answers `null` (not the raw path) for
 * anything it cannot sign, so the tile draws its own art.
 */
export function useResolvedCoverUrl(
  coverPath?: string | null,
  options?: { variant?: 'thumb' | 'original' },
): string | null | undefined {
  const [resolved, setResolved] = useState<string | null | undefined>(undefined);
  const variant = options?.variant || 'original';

  useEffect(() => {
    if (!coverPath) {
      setResolved(undefined);
      return;
    }

    let cancelled = false;
    setResolved(undefined);

    void resolveCoverDisplayUrl(coverPath, { variant })
      .then(url => {
        if (!cancelled) setResolved(url ?? null);
      })
      .catch(() => {
        if (!cancelled) setResolved(null);
      });

    return () => {
      cancelled = true;
    };
  }, [coverPath, variant]);

  return resolved;
}
