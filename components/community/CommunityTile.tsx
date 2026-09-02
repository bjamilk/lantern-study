import React, { useMemo } from 'react';
import { avatarColorFromSeed, initialsFromName } from '@lantern/shared/design';

/**
 * The community's square tile — initials on the community's seed colour
 * (communities have no avatar). Same tile in the column header (32px) and
 * the page header (56px).
 */
export const CommunityTile: React.FC<{
  name: string;
  size?: 'sm' | 'lg';
  className?: string;
}> = ({ name, size = 'sm', className = '' }) => {
  const initials = useMemo(() => initialsFromName(name || '?'), [name]);
  const bgColor = useMemo(() => avatarColorFromSeed(name || '?'), [name]);
  const sizeClasses = size === 'lg' ? 'w-14 h-14 text-lg rounded-2xl' : 'w-8 h-8 text-xs rounded-lg';
  return (
    <span
      role="img"
      aria-label={name}
      className={`${sizeClasses} inline-flex shrink-0 items-center justify-center font-semibold text-white ring-2 ring-lantern-primary/20 ${className}`}
      style={{ backgroundColor: bgColor }}
    >
      {initials}
    </span>
  );
};

export default CommunityTile;
