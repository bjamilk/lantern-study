import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '../../theme';
import { useToastStore } from '../../stores/toastStore';
import { AppIcon, type AppIconName } from '../ui/AppIcon';

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
    icon: AppIconName,
    onPress: () => void,
    color?: string,
    // Toggles paint their glyph solid when on, so the state is not colour-only.
    filled?: boolean
  ) => (
    <Pressable
      key={label}
      onPress={onPress}
      className="h-11 w-11 items-center justify-center"
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <AppIcon name={icon} filled={filled} size={22} color={color || colors.text} />
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
        <AppIcon name="close" size={24} color={colors.text} />
      </Pressable>
      <View className="flex-1" />
      {/* Generous gaps so neighbouring actions cannot be fat-fingered. */}
      <View className="flex-row items-center gap-2 pr-1">
        {button('Reply', 'arrow-undo', onReply)}
        {onForward ? button('Forward', 'arrow-redo', onForward) : null}
        {onCopy ? button('Copy text', 'copy', onCopy) : null}
        {button(starred ? 'Unstar' : 'Star', 'star', onStar, starred ? '#f59e0b' : undefined, starred)}
        {button(pinned ? 'Unpin' : 'Pin', 'pin', onPin, pinned ? colors.primary : undefined, pinned)}
        {onDelete ? button('Delete', 'trash', onDelete, colors.error) : null}
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
            <AppIcon name="trash" size={22} color={colors.textSecondary} />
          </Pressable>
        ) : null}
        {onMore ? button('More actions', 'ellipsis-vertical', onMore) : null}
      </View>
    </View>
  );
}

export default MessageActionBar;
