import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { formatCommunityUnread } from '@lantern/shared/network';
import { AppIcon } from '../ui/AppIcon';

/** The shared community rule (§6): two digits, then 99+. */
export function formatUnreadPill(unread: number): string {
  return formatCommunityUnread(unread);
}

/**
 * The red unread pill shared by channel rows and the hub's community cards.
 * `min-w-[20px]` keeps a single digit round; the pill grows for `99+`.
 */
export function UnreadPill({ unread }: { unread: number }) {
  if (!unread || unread <= 0) return null;
  return (
    <View className="ml-2 min-w-[20px] h-[20px] px-1.5 rounded-full bg-lantern-error items-center justify-center">
      <Text className="text-label font-bold text-white">{formatUnreadPill(unread)}</Text>
    </View>
  );
}

/**
 * One board (`# name`) in the community's server view.
 *
 * The community's ONE live chat — the lounge, rendered as `General` — reuses
 * this row with `chat`, which swaps the `#` for a speech bubble: founder
 * decision 4 (2026-09-02) is that the chat room must read differently from the
 * boards at a glance.
 */
export function ChannelRow({
  displayName,
  subtitle,
  unread,
  visibility,
  joined,
  busy,
  chat,
  onPress,
}: {
  displayName: string;
  subtitle: string;
  unread: number;
  /** Lock glyph for members-only boards, globe for public; omitted on the lounge. */
  visibility?: 'community' | 'public';
  /** Unjoined rows dim to 70% — they read "tap to join". */
  joined: boolean;
  busy?: boolean;
  /** The lounge: a live chat, not a board — no `#`. */
  chat?: boolean;
  onPress: () => void;
}) {
  const label = unread > 0 ? `${displayName}, ${unread} unread` : displayName;
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!busy, busy: !!busy }}
      className={`flex-row items-center px-4 min-h-[52px] active:bg-lantern-background-secondary ${
        joined ? '' : 'opacity-70'
      }`}
      style={busy ? { opacity: 0.5 } : undefined}
    >
      {chat ? (
        <View className="w-5 items-center">
          <AppIcon name="chatbubbles" size={16} color="#94a3b8" />
        </View>
      ) : (
        <Text className="w-5 text-base font-semibold text-lantern-text-tertiary">#</Text>
      )}
      <View className="flex-1 min-w-0 ml-1">
        <Text
          className={`text-[15px] text-lantern-text ${unread > 0 ? 'font-bold' : 'font-medium'}`}
          numberOfLines={1}
        >
          {displayName.replace(/^#\s*/, '')}
        </Text>
        <Text className="text-xs text-lantern-text-tertiary mt-0.5" numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      {visibility === 'community' ? (
        <AppIcon name="lock-closed" size={12} color="#94a3b8" />
      ) : visibility === 'public' ? (
        <AppIcon name="globe" size={12} color="#94a3b8" />
      ) : null}
      <UnreadPill unread={unread} />
    </Pressable>
  );
}

export default ChannelRow;
