import React from 'react';
import { useResolvedStorageUrl } from '../../hooks/useResolvedStorageUrl';

type Props = React.ImgHTMLAttributes<HTMLImageElement> & {
  src?: string | null;
  variant?: 'thumb' | 'original';
  /**
   * Drawn instead of the picture when the ref cannot be signed or the image
   * fails to load. Without it the component renders nothing, which inside a
   * fixed-size tile is a grey hole rather than the caller's own art.
   */
  fallback?: React.ReactNode;
};

/** Drop-in <img> that re-signs private storage URLs before display. */
export function ResolvedStorageImg({
  src,
  variant = 'original',
  alt = '',
  loading = 'lazy',
  fallback = null,
  ...rest
}: Props) {
  const resolved = useResolvedStorageUrl(src, { variant });
  // Reset per resolved URL: a retry (or a re-signed URL) must get a real chance
  // to paint rather than stay stuck on the fallback from the previous failure.
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [resolved]);

  // `undefined` is "still signing" and `null` is "cannot be signed"; a tile
  // shows its own art in both cases rather than an empty box.
  if (!resolved || failed) return <>{fallback}</>;
  return (
    <img
      src={resolved}
      alt={alt}
      loading={loading}
      {...rest}
      onError={(event) => {
        setFailed(true);
        rest.onError?.(event);
      }}
    />
  );
}
