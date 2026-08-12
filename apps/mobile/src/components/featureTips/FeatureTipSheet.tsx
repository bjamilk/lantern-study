import React from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FEATURE_TIP_CATALOG, type FeatureTipId } from '@lantern/shared/featureTips';
import { useTheme } from '../../theme';
import { useFeatureTipStore, getTipCopy } from '../../stores/featureTipStore';
import { useSettingsStore } from '../../stores/settingsStore';

interface FeatureTipSheetProps {
  tipId: FeatureTipId | null;
}

/**
 * Bottom-sheet coach tip for the active feature tip (one at a time).
 */
export function FeatureTipSheet({ tipId }: FeatureTipSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const dismiss = useFeatureTipStore((s) => s.dismiss);
  const skipAll = useFeatureTipStore((s) => s.skipAll);
  const dontShowAgain = useFeatureTipStore((s) => s.dontShowAgain);
  const reduceMotion =
    useSettingsStore((s) => s.settings.accessibility.reduceMotion) ||
    !useSettingsStore((s) => s.settings.appearance.showAnimations);

  if (!tipId) return null;
  const copy = getTipCopy(tipId) || FEATURE_TIP_CATALOG[tipId];
  if (!copy) return null;

  return (
    <Modal
      visible
      transparent
      animationType={reduceMotion ? 'none' : 'slide'}
      onRequestClose={() => dismiss(tipId)}
    >
      <Pressable
        className="flex-1 justify-end"
        style={{ backgroundColor: colors.modalOverlay }}
        onPress={() => dismiss(tipId)}
      >
        <Pressable
          className="rounded-t-2xl px-4 pt-3 pb-6"
          style={{
            backgroundColor: colors.modalBackground,
            // Sits flush with the bottom of the screen, so the action row lands
            // under the system navigation bar / gesture pill on devices that
            // have one — "Got it" and "Skip all" were hard or impossible to
            // tap. Clear the real inset instead of a fixed guess.
            paddingBottom: insets.bottom + (Platform.OS === 'ios' ? 28 : 20),
            borderTopWidth: 2,
            borderTopColor: colors.primary,
            maxHeight: Math.min(windowHeight * 0.7, 420),
          }}
          onPress={(e) => e.stopPropagation()}
        >
          <View className="w-10 h-1 rounded-full self-center mb-3" style={{ backgroundColor: colors.border }} />
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Text className="text-base font-semibold mb-1" style={{ color: colors.text }}>
              {copy.title}
            </Text>
            <Text className="text-sm leading-5 mb-4" style={{ color: colors.textSecondary }}>
              {copy.body}
            </Text>
            <View className="flex-row flex-wrap gap-2 items-center">
              <Pressable
                onPress={() => dismiss(tipId)}
                className="px-4 py-2.5 rounded-lg"
                style={{ backgroundColor: colors.primary }}
              >
                <Text className="text-sm font-medium text-white">{copy.gotItLabel || 'Got it'}</Text>
              </Pressable>
              <Pressable
                onPress={() => dontShowAgain()}
                className="px-3 py-2.5 rounded-lg"
                style={{ backgroundColor: colors.backgroundSecondary }}
              >
                <Text className="text-sm font-medium" style={{ color: colors.textSecondary }}>
                  {copy.dontShowAgainLabel || "Don't show again"}
                </Text>
              </Pressable>
              <Pressable onPress={() => skipAll()} className="ml-auto px-2 py-2.5">
                <Text className="text-xs" style={{ color: colors.textTertiary }}>
                  Skip all
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default FeatureTipSheet;
