/** Returns avatar URL only if it's a real uploaded image, not ui-avatars fallback */
export function resolveAvatarSrc(
  src?: string | null,
  localOnly = false
): string | null {
  if (localOnly || !src) return null;
  if (src.includes('ui-avatars.com')) return null;
  return src;
}

/** Legacy helper — returns empty string instead of ui-avatars URL */
export function avatarFallback(_name: string): string {
  return '';
}
