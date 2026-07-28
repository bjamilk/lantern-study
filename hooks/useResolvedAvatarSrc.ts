import { useResolvedStorageUrl } from './useResolvedStorageUrl';

/** Resolve private storage avatar paths to signed URLs for display. */
export function useResolvedAvatarSrc(src?: string | null): string | undefined {
  return useResolvedStorageUrl(src, { expiresInSeconds: 60 * 60 * 6 });
}
