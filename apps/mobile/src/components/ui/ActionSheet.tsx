/**
 * Bottom action sheet for menus with more than a couple of options.
 *
 * `Alert.alert` cannot be used for these: Android's native dialog supports at
 * most three buttons and silently drops the rest, so the deck menu's seven
 * items rendered as three on Android and every extra action — Export JSON,
 * Export CSV, Collaborators — was unreachable, while iOS showed them all. This
 * renders the same list on both platforms and scrolls when the list is long.
 */
import React from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppIcon, type AppIconName } from './AppIcon';

export interface ActionSheetItem {
  label: string;
  onPress: () => void;
  icon?: AppIconName;
  /**
   * Paints the icon solid. Used where the row toggles a state the icon itself
   * shows — a starred chat, a pinned note — so the state does not rest on the
   * label text alone.
   */
  iconFilled?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  /** Shown under the label for actions whose effect is not obvious. */
  hint?: string;
  /** Groups related actions under a heading so a long menu stays scannable. */
  section?: string;
  /**
   * Screen-reader label when the visible label is too terse on its own
   * ("No background" → "Remove the background from this chat"). Defaults to
   * `label`.
   */
  accessibilityLabel?: string;
}

interface ActionSheetProps {
  visible: boolean;
  title?: string;
  items: ActionSheetItem[];
  onClose: () => void;
  cancelLabel?: string;
}

export function ActionSheet({
  visible,
  title,
  items,
  onClose,
  cancelLabel = 'Cancel',
}: ActionSheetProps) {
  // Same edge-to-edge trap as ConfirmSheetHost: without the inset the last
  // row sinks under the system navigation bar.
  const insets = useSafeAreaInsets();
  const select = (item: ActionSheetItem) => {
    if (item.disabled) return;
    // Close first so the sheet is never left open behind a modal or an alert
    // that the action itself opens.
    onClose();
    item.onPress();
  };

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/50 justify-end" onPress={onClose}>
        <Pressable
          accessibilityViewIsModal
          accessibilityLabel={title}
          onPress={(e) => e.stopPropagation?.()}
          className="bg-lantern-surface rounded-t-3xl pt-5"
        style={{ paddingBottom: insets.bottom + 20 }}
        >
          {title ? (
            <Text
              className="text-lg font-bold text-lantern-text px-5 mb-3"
              accessibilityRole="header"
            >
              {title}
            </Text>
          ) : null}

          <ScrollView className="max-h-[28rem]" showsVerticalScrollIndicator={false}>
            {items.map((item, index) => (
              <React.Fragment key={item.label}>
                {item.section && item.section !== items[index - 1]?.section ? (
                  <Text className="px-5 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-lantern-text-tertiary">
                    {item.section}
                  </Text>
                ) : null}
              <Pressable
                onPress={() => select(item)}
                disabled={item.disabled}
                accessibilityRole="button"
                accessibilityLabel={item.accessibilityLabel || item.label}
                accessibilityState={{ disabled: !!item.disabled }}
                // minHeight guarantees the 44pt touch target even at the
                // smallest font-size setting, where padding + one line lands
                // right on the boundary.
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
                    color={item.destructive ? '#ef4444' : '#6366f1'}
                  />
                ) : null}
                <View className="flex-1">
                  <Text
                    className={`text-base font-medium ${
                      item.destructive ? 'text-red-500' : 'text-lantern-text'
                    }`}
                  >
                    {item.label}
                  </Text>
                  {item.hint ? (
                    <Text className="text-xs text-lantern-text-secondary mt-0.5">{item.hint}</Text>
                  ) : null}
                </View>
              </Pressable>
              </React.Fragment>
            ))}
          </ScrollView>

          <View className="px-5 pt-3">
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              className="py-3 rounded-2xl bg-lantern-background-secondary dark:bg-lantern-surface-secondary items-center"
            >
              <Text className="font-semibold text-lantern-text">{cancelLabel}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
