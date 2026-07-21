import React, { useMemo } from 'react';
import { Image, Text, View } from 'react-native';
import { avatarColorFromSeed, initialsFromName } from '@lantern/shared/design';
import { useResolvedStorageUrl } from '../hooks/useResolvedStorageUrl';

/**
 * Profile avatar that re-signs private `profile-avatars` URLs for React Native Image.
 */
export function ResolvedAvatar({
  name,
  uri,
  size = 40,
  className = '',
}: {
  name?: string | null;
  uri?: string | null;
  size?: number;
  className?: string;
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
        accessibilityLabel={name || 'Avatar'}
      />
    );
  }

  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg }}
      className={`items-center justify-center ${className}`}
      accessibilityLabel={name || 'Avatar'}
    >
      <Text style={{ fontSize: Math.max(12, size * 0.38), color: '#fff', fontWeight: '600' }}>
        {initials}
      </Text>
    </View>
  );
}

export default ResolvedAvatar;
