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
import { Ionicons } from '@expo/vector-icons';

export interface ActionSheetItem {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  destructive?: boolean;
  disabled?: boolean;
  /** Shown under the label for actions whose effect is not obvious. */
  hint?: string;
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
          className="bg-lantern-surface rounded-t-3xl pt-5 pb-8"
        >
          {title ? (
            <Text
              className="text-lg font-bold text-lantern-text px-5 mb-3"
              accessibilityRole="header"
            >
              {title}
            </Text>
          ) : null}

          <ScrollView className="max-h-96" showsVerticalScrollIndicator={false}>
            {items.map((item) => (
              <Pressable
                key={item.label}
                onPress={() => select(item)}
                disabled={item.disabled}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                accessibilityState={{ disabled: !!item.disabled }}
                className={`flex-row items-center gap-3 px-5 py-3.5 active:bg-lantern-background-secondary ${
                  item.disabled ? 'opacity-40' : ''
                }`}
              >
                {item.icon ? (
                  <Ionicons
                    name={item.icon}
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
