import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { COMMUNITY_BOARD_COPY, pinnedPostAccessibilityLabel } from '@lantern/shared/network';
import { splitBoardBody } from '../../utils/boardPosts';
import type { Message } from '../../stores/groupStore';
import { AppIcon } from '../ui/AppIcon';
import { brand } from '../../theme';

/**
 * The board's one server-side pinned post (§4.1 region 2). Every member sees
 * the same strip — it replaces the device-local AsyncStorage pin, which was
 * single, mobile-only and visible to exactly one person.
 */
export function PinnedBanner({
  post,
  canUnpin,
  busy,
  onPress,
  onUnpin,
}: {
  post: Message;
  canUnpin: boolean;
  busy?: boolean;
  onPress: () => void;
  onUnpin: () => void;
}) {
  const { body, imageUrl, audioUrl } = splitBoardBody(post.text);
  const snippet =
    post.subject?.trim() ||
    body ||
    (imageUrl ? COMMUNITY_BOARD_COPY.photoTapToLoad : '') ||
    (audioUrl ? COMMUNITY_BOARD_COPY.voiceNote : '');

  return (
    <View className="flex-row items-center border-b border-lantern-border bg-lantern-background-secondary px-4 py-2">
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={pinnedPostAccessibilityLabel({
          senderName: post.senderName,
          subject: post.subject ?? null,
          text: body,
        })}
        className="flex-1 min-w-0 min-h-[44px] justify-center"
      >
        <View className="flex-row items-center">
          <AppIcon name="pin" size={12} color={brand.text} />
          <Text className="ml-1 text-label font-bold tracking-wide text-lantern-primary-text">
            {COMMUNITY_BOARD_COPY.pinnedLabel}
          </Text>
          <Text className="ml-2 text-[11px] text-lantern-text-tertiary" numberOfLines={1}>
            {post.senderName}
          </Text>
        </View>
        <Text className="text-[13px] text-lantern-text" numberOfLines={1}>
          {snippet}
        </Text>
      </Pressable>

      {canUnpin ? (
        <Pressable
          onPress={onUnpin}
          disabled={busy}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={COMMUNITY_BOARD_COPY.unpin}
          accessibilityState={{ disabled: !!busy, busy: !!busy }}
          className="ml-2 min-h-[44px] min-w-[44px] items-center justify-center"
          style={busy ? { opacity: 0.5 } : undefined}
        >
          <Text className="text-xs font-semibold text-lantern-primary-text">
            {COMMUNITY_BOARD_COPY.unpin}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default PinnedBanner;
