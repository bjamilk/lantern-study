import React from 'react';
import { useResolvedStorageUrl } from '../../hooks/useResolvedStorageUrl';

type Props = React.ImgHTMLAttributes<HTMLImageElement> & {
  src?: string | null;
  variant?: 'thumb' | 'original';
};

/** Drop-in <img> that re-signs private storage URLs before display. */
export function ResolvedStorageImg({
  src,
  variant = 'original',
  alt = '',
  loading = 'lazy',
  ...rest
}: Props) {
  const resolved = useResolvedStorageUrl(src, { variant });
  if (!resolved) return null;
  return <img src={resolved} alt={alt} loading={loading} {...rest} />;
}
