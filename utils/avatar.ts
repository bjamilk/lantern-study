/**
 * Returns avatar URL only if it's a real uploaded image, not ui-avatars fallback.
 * Re-exported from shared so web and mobile apply the same rule.
 */
export { resolveAvatarSrc } from '@lantern/shared/utils';

/** Legacy helper — returns empty string instead of ui-avatars URL */
export function avatarFallback(_name: string): string {
  return '';
}
