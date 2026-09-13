import React from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { firstLinkPreviewUrl, linkPreviewHostname } from '@lantern/shared/chat';
import { useTheme } from '../../theme';
import { AppIcon } from '../ui/AppIcon';

export function LinkPreviewChip({ text }: { text?: string | null }) {
  const { colors } = useTheme();
  const url = firstLinkPreviewUrl(text);
  if (!url) return null;
  return (
    <Pressable
      onPress={() => void Linking.openURL(url)}
      className="mt-2 flex-row items-center gap-2 rounded-lg border px-2.5 py-2"
      style={{ borderColor: colors.border, backgroundColor: colors.backgroundSecondary }}
      accessibilityRole="link"
      accessibilityLabel={`Open ${linkPreviewHostname(url)}`}
    >
      <AppIcon name="link" size={14} color={colors.textSecondary} />
      <View className="flex-1 min-w-0">
        <Text className="text-caption font-semibold" style={{ color: colors.text }} numberOfLines={1}>
          {linkPreviewHostname(url)}
        </Text>
        <Text className="text-label" style={{ color: colors.textTertiary }} numberOfLines={1}>
          {url}
        </Text>
      </View>
    </Pressable>
  );
}
