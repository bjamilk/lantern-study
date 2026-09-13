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
import { SHEET, brand, useTheme } from '../../theme';
import { AppIcon, type AppIconName } from './AppIcon';
import { Title } from './Text';

/**
 * The grabber — the 64x6 dp bar at the top of every sheet in the app.
 *
 * It is not decoration and it is not a control: it is the affordance that says
 * "this panel is draggable and dismissable", which is the only visual cue a
 * sheet has once it has stopped animating. Exported so the other sheets in the
 * app draw the same one rather than each inventing a width.
 *
 * Hidden from the screen reader: a reader dismisses the sheet with the
 * standard back/escape gesture, and announcing a nameless bar helps nobody.
 */
export function SheetGrabber() {
  const { colors } = useTheme();
  return (
    <View className="items-center pb-3" importantForAccessibility="no-hide-descendants">
      <View
        style={{
          width: SHEET.grabberWidth,
          height: SHEET.grabberHeight,
          borderRadius: SHEET.grabberRadius,
          backgroundColor: colors.border,
        }}
      />
    </View>
  );
}

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
  const { colors } = useTheme();
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
          className="pt-3"
          style={{
            // The sheet's ground is the page CREAM, not white (founder
            // direction 2026-09-11): its rows are white, and a white panel
            // under white rows is one flat plane with dividers drawn on it.
            // Cream under white is two planes, which is what makes a row read
            // as a thing you can press.
            backgroundColor: colors.background,
            borderTopLeftRadius: SHEET.topRadius,
            borderTopRightRadius: SHEET.topRadius,
            paddingBottom: insets.bottom + 20,
          }}
        >
          <SheetGrabber />
          {title ? (
            // The serif display step — a sheet's heading is a screen's h1 in a
            // panel, so it takes the same voice. `text-lg` was 15.75 sp here,
            // which is smaller than the rows it was introducing.
            <Title
              className="px-5 mb-3"
              numberOfLines={2}
              accessibilityRole="header"
            >
              {title}
            </Title>
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
                style={{
                  minHeight: SHEET.rowMinHeight,
                  backgroundColor: colors.surface,
                  borderRadius: SHEET.rowRadius,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
                className={`mx-4 mb-2 flex-row items-center gap-3 px-4 py-3 active:opacity-80 ${
                  item.disabled ? 'opacity-40' : ''
                }`}
              >
                {item.icon ? (
                  <AppIcon
                    name={item.icon}
                    filled={item.iconFilled}
                    size={20}
                    color={item.destructive ? '#ef4444' : brand.text}
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

          <View className="px-4 pt-2">
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              style={{
                minHeight: SHEET.rowMinHeight,
                borderRadius: SHEET.rowRadius,
                borderWidth: 1,
                borderColor: colors.border,
              }}
              className="items-center justify-center active:opacity-80"
            >
              <Text className="font-semibold text-body text-lantern-text">{cancelLabel}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
