import React, { useMemo } from 'react';
import { avatarColorFromSeed } from '@lantern/shared/design';
import { realNameOrNull, resolveAvatarIdentity } from '../../utils/displayIdentity';
import { useResolvedAvatarSrc } from '../../hooks/useResolvedAvatarSrc';

interface AvatarProps {
  name: string;
  /**
   * Stable per-account identifier, used ONLY to seed the background colour.
   * The colour must not be seeded from the display name: every nameless account
   * resolves to the same neutral label ("User"), so a name/label seed paints
   * them all one colour — a wall of identical chips in a member list. It must
   * not be seeded from the email either (nothing a reader can see should be
   * derived from the address). Pass the account id here for a colour that is
   * unique per account and unchanged by renames. Optional so existing callers
   * keep working; when it is absent the colour falls back to the raw name (see
   * below), which separates distinct accounts but still collapses genuinely
   * nameless ones — pass `id` in member lists to avoid that.
   */
  id?: string;
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
  id,
  src,
  size = 'md',
  className = '',
  localOnly = false,
}) => {
  // Initials AND the accessibility label are seeded from the resolved name
  // only: a blank or email-shaped name has no initials to invent, so it draws a
  // neutral mark ("?") and reads as the neutral placeholder — the email is never
  // turned into fake initials, nor spoken by a screen reader.
  const { initials, label } = useMemo(() => resolveAvatarIdentity(name), [name]);
  // Colour seed — a stable, per-account value that is deliberately NOT the
  // resolved `label`. Seeding from the label painted every nameless account the
  // same colour, because they all resolve to the one neutral label. Prefer the
  // account `id` (unique per account, unchanged by renames, never shown to a
  // reader); fall back to a GENUINE name so distinct named accounts still
  // separate, and finally to the label so an avatar is never left seedless. The
  // fallback is a real name only: an email-shaped `name` is dropped, because the
  // colour must not be derived from the address (`realNameOrNull` returns null
  // for one, and the label — 'User' — is used instead).
  const colorSeed = id?.trim() || realNameOrNull(name) || label;
  const bgColor = useMemo(() => avatarColorFromSeed(colorSeed), [colorSeed]);
  const resolvedSrc = useResolvedAvatarSrc(localOnly ? null : src);
  const showImage = resolvedSrc && !localOnly;

  if (showImage) {
    return (
      <img
        src={resolvedSrc}
        alt={label}
        loading="lazy"
        className={`${sizeClasses[size]} rounded-full object-cover shrink-0 ${className}`}
      />
    );
  }

  return (
    <span
      role="img"
      aria-label={label}
      className={`${sizeClasses[size]} rounded-full inline-flex items-center justify-center font-semibold text-white shrink-0 ${className}`}
      style={{ backgroundColor: bgColor }}
    >
      {initials}
    </span>
  );
};

export default Avatar;
