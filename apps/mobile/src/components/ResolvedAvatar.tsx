import React, { useMemo } from 'react';
import { Image, Text, View } from 'react-native';
import { avatarColorFromSeed, initialsFromName } from '@lantern/shared/design';
import { useResolvedStorageUrl } from '../hooks/useResolvedStorageUrl';

/**
 * Profile avatar that re-signs private `profile-avatars` URLs for React Native Image.
 *
 * Pass `decorative` when the avatar sits next to visible text that already
 * names the same person or group (chat headers, message rows). Without it,
 * TalkBack announced the name from the avatar, then the initials ("ZZ"), then
 * the name again from the adjacent title.
 */
export function ResolvedAvatar({
  name,
  uri,
  size = 40,
  className = '',
  decorative = false,
}: {
  name?: string | null;
  uri?: string | null;
  size?: number;
  className?: string;
  decorative?: boolean;
}) {
  const resolved = useResolvedStorageUrl(uri);
  const initials = useMemo(() => initialsFromName(name || '?'), [name]);
  const bg = useMemo(() => avatarColorFromSeed(name || '?'), [name]);

  if (resolved) {
    return (
      <Image
        source={{ uri: resolved }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        className={className}
        accessibilityLabel={decorative ? undefined : name || 'Avatar'}
        importantForAccessibility={decorative ? 'no-hide-descendants' : 'auto'}
        accessibilityElementsHidden={decorative}
      />
    );
  }

  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg }}
      className={`items-center justify-center ${className}`}
      accessibilityLabel={decorative ? undefined : name || 'Avatar'}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'auto'}
      accessibilityElementsHidden={decorative}
    >
      <Text
        // The initials are drawn, not read: the wrapper's label covers the
        // non-decorative case, and decorative avatars are hidden entirely.
        importantForAccessibility="no"
        style={{ fontSize: Math.max(12, size * 0.38), color: '#fff', fontWeight: '600' }}
      >
        {initials}
      </Text>
    </View>
  );
}

export default ResolvedAvatar;
