import React, { useMemo } from 'react';
import { avatarColorFromSeed, initialsFromName } from '@lantern/shared/design';
import { useResolvedAvatarSrc } from '../../hooks/useResolvedAvatarSrc';

interface AvatarProps {
  name: string;
  src?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  /** When true, never load remote src (low-data mode) */
  localOnly?: boolean;
}

// Initials sit on the six-step scale so they grow with the app's text-size
// setting; the CIRCLE stays fixed (w-/h-), which is what keeps the avatar the
// same shape at every setting. `text-[10px]` on xs did neither.
const sizeClasses = {
  xs: 'w-6 h-6 text-label tracking-normal',
  sm: 'w-8 h-8 text-caption',
  md: 'w-10 h-10 text-body',
  lg: 'w-12 h-12 text-heading',
  xl: 'w-16 h-16 text-title',
};

export const Avatar: React.FC<AvatarProps> = ({
  name,
  src,
  size = 'md',
  className = '',
  localOnly = false,
}) => {
  const initials = useMemo(() => initialsFromName(name), [name]);
  const bgColor = useMemo(() => avatarColorFromSeed(name || '?'), [name]);
  const resolvedSrc = useResolvedAvatarSrc(localOnly ? null : src);
  const showImage = resolvedSrc && !localOnly;

  if (showImage) {
    return (
      <img
        src={resolvedSrc}
        alt={name}
        loading="lazy"
        className={`${sizeClasses[size]} rounded-full object-cover shrink-0 ${className}`}
      />
    );
  }

  return (
    <span
      role="img"
      aria-label={name}
      className={`${sizeClasses[size]} rounded-full inline-flex items-center justify-center font-semibold text-white shrink-0 ${className}`}
      style={{ backgroundColor: bgColor }}
    >
      {initials}
    </span>
  );
};

export default Avatar;
