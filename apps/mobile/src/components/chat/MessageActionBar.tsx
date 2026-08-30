import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { useToastStore } from '../../stores/toastStore';

interface Props {
  onClose: () => void;
  onReply: () => void;
  /** Hidden for media messages (their text is markdown-wrapped URLs). */
  onForward?: () => void;
  onCopy?: () => void;
  onStar: () => void;
  onPin: () => void;
  starred: boolean;
  pinned: boolean;
  /** Soft-remove this message. Present only when the viewer may remove it. */
  onDelete?: () => void;
  /**
   * Set when the viewer OWNS the message but cannot remove it (a question, or
   * the 30-minute window has closed). Renders a dimmed Delete that explains
   * itself instead of silently omitting the action.
   */
  deleteBlockedReason?: string;
  /** Overflow (edit / remove / report) when any such action applies. */
  onMore?: () => void;
}

/**
 * Contextual bar for a long-pressed message. Temporarily replaces the chat
 * header — same pattern as the chat list's selection bar — instead of a
 * bottom sheet, so the message stays visible while acting on it.
 */
export function MessageActionBar({
  onClose,
  onReply,
  onForward,
  onCopy,
  onStar,
  onPin,
  starred,
  pinned,
  onDelete,
  deleteBlockedReason,
  onMore,
}: Props) {
  const { colors } = useTheme();

  const button = (
    label: string,
    icon: React.ComponentProps<typeof Ionicons>['name'],
    onPress: () => void,
    color?: string
  ) => (
    <Pressable
      key={label}
      onPress={onPress}
      className="h-11 w-11 items-center justify-center"
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={22} color={color || colors.text} />
    </Pressable>
  );

  return (
    <View
      className="flex-row items-center px-1 py-1 border-b border-lantern-border bg-lantern-surface"
      accessibilityLabel="Message actions"
    >
      <Pressable
        onPress={onClose}
        className="h-11 w-11 items-center justify-center"
        accessibilityRole="button"
        accessibilityLabel="Close message actions"
      >
        <Ionicons name="close" size={24} color={colors.text} />
      </Pressable>
      <View className="flex-1" />
      {/* Generous gaps so neighbouring actions cannot be fat-fingered. */}
      <View className="flex-row items-center gap-2 pr-1">
        {button('Reply', 'arrow-undo-outline', onReply)}
        {onForward ? button('Forward', 'arrow-redo-outline', onForward) : null}
        {onCopy ? button('Copy text', 'copy-outline', onCopy) : null}
        {button(starred ? 'Unstar' : 'Star', starred ? 'star' : 'star-outline', onStar, starred ? '#f59e0b' : undefined)}
        {button(pinned ? 'Unpin' : 'Pin', 'pin-outline', onPin, pinned ? colors.primary : undefined)}
        {onDelete ? button('Delete', 'trash-outline', onDelete, colors.error) : null}
        {!onDelete && deleteBlockedReason ? (
          <Pressable
            key="delete-blocked"
            onPress={() =>
              useToastStore.getState().showToast(deleteBlockedReason, 'info')
            }
            className="h-11 w-11 items-center justify-center"
            accessibilityRole="button"
            accessibilityLabel="Delete unavailable"
            accessibilityHint={deleteBlockedReason}
            style={{ opacity: 0.4 }}
          >
            <Ionicons name="trash-outline" size={22} color={colors.textSecondary} />
          </Pressable>
        ) : null}
        {onMore ? button('More actions', 'ellipsis-vertical', onMore) : null}
      </View>
    </View>
  );
}

export default MessageActionBar;
