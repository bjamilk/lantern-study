import React from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { AppIcon, type AppIconName } from '../ui/AppIcon';
import type { ActionSheetItem } from '../ui/ActionSheet';
import { ReactionPickerRow } from './MessageReactions';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Quick-reaction strip. Hidden when the surface can't take reactions. */
  myReactions?: string[];
  onReact?: (emoji: string, added: boolean) => void;
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
   * the 30-minute window has closed). Renders a disabled Delete whose reason is
   * spelled out beneath it — the greyed trash stops being a mystery.
   */
  deleteBlockedReason?: string;
  /** Extra rows (Edit / Flag / Report) folded in so there is a single sheet. */
  extraItems?: ActionSheetItem[];
}

/**
 * Bottom sheet for a long-pressed message.
 *
 * Replaces the old top-anchored icon-only bar: that sat far from the message it
 * acted on and its six glyphs carried no labels. This is the app's standard
 * ActionSheet shape — thumb-reachable, every action spelled out — with a
 * quick-reaction strip kept on top so a one-tap emoji is still one tap.
 */
export function MessageActionSheet({
  visible,
  onClose,
  myReactions,
  onReact,
  onReply,
  onForward,
  onCopy,
  onStar,
  onPin,
  starred,
  pinned,
  onDelete,
  deleteBlockedReason,
  extraItems = [],
}: Props) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const items: ActionSheetItem[] = [
    { label: 'Reply', icon: 'arrow-undo', onPress: onReply },
    ...(onForward ? [{ label: 'Forward', icon: 'arrow-redo' as AppIconName, onPress: onForward }] : []),
    ...(onCopy ? [{ label: 'Copy text', icon: 'copy' as AppIconName, onPress: onCopy }] : []),
    {
      label: starred ? 'Unstar' : 'Star',
      icon: 'star',
      iconFilled: starred,
      onPress: onStar,
    },
    {
      label: pinned ? 'Unpin' : 'Pin',
      icon: 'pin',
      iconFilled: pinned,
      onPress: onPin,
    },
    ...extraItems,
    ...(onDelete
      ? [{ label: 'Delete', icon: 'trash' as AppIconName, destructive: true, onPress: onDelete }]
      : deleteBlockedReason
        ? [
            {
              label: 'Delete',
              icon: 'trash' as AppIconName,
              disabled: true,
              hint: deleteBlockedReason,
              onPress: () => undefined,
            },
          ]
        : []),
  ];

  const select = (item: ActionSheetItem) => {
    if (item.disabled) return;
    // Close first so the sheet is never left open behind a modal or a confirm
    // dialog that the action itself opens.
    onClose();
    item.onPress();
  };

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/50 justify-end" onPress={onClose}>
        <Pressable
          accessibilityViewIsModal
          accessibilityLabel="Message actions"
          onPress={(e) => e.stopPropagation?.()}
          className="bg-lantern-surface rounded-t-3xl overflow-hidden"
          style={{ paddingBottom: insets.bottom + 12 }}
        >
          {onReact ? (
            <ReactionPickerRow mine={myReactions} onPick={onReact} />
          ) : null}

          <ScrollView className="max-h-[26rem]" showsVerticalScrollIndicator={false}>
            {items.map((item) => (
              <Pressable
                key={item.label}
                onPress={() => select(item)}
                disabled={item.disabled}
                accessibilityRole="button"
                accessibilityLabel={item.accessibilityLabel || item.label}
                accessibilityState={{ disabled: !!item.disabled }}
                accessibilityHint={item.hint}
                // minHeight guarantees the 44pt touch target even at the
                // smallest font-size setting.
                style={{ minHeight: 44 }}
                className={`flex-row items-center gap-3 px-5 py-3.5 active:bg-lantern-background-secondary ${
                  item.disabled ? 'opacity-40' : ''
                }`}
              >
                {item.icon ? (
                  <AppIcon
                    name={item.icon}
                    filled={item.iconFilled}
                    size={20}
                    color={item.destructive ? colors.error : colors.primary}
                  />
                ) : null}
                <View className="flex-1">
                  <Text
                    className="text-body font-medium"
                    style={{ color: item.destructive ? colors.error : colors.text }}
                  >
                    {item.label}
                  </Text>
                  {item.hint ? (
                    <Text className="text-caption mt-0.5" style={{ color: colors.textSecondary }}>
                      {item.hint}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </ScrollView>

          <View className="px-5 pt-2">
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close message actions"
              className="py-3 rounded-2xl bg-lantern-background-secondary dark:bg-lantern-surface-secondary items-center"
            >
              <Text className="font-semibold text-lantern-text">Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default MessageActionSheet;
