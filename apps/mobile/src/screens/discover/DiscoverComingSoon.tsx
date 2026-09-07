import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { COMMUNITY_GATE_COPY } from '@lantern/shared/network';
import { Screen } from '../../components/layout';

/**
 * Shown when the community gate refuses. The gate is the shared
 * `canAccessDiscoverHub` object form (via `useCommunityAccess`): a platform
 * admin always passes, so the only reader who lands here is a student whose
 * profile has no institution or programme yet — and the copy says exactly
 * that, never "coming soon".
 */
export function DiscoverComingSoon({
  onBack,
  backLabel = 'Back to Library',
}: {
  onBack?: () => void;
  backLabel?: string;
}) {
  return (
    <Screen bottom="none" testID="discover-coming-soon">
      <View className="px-4 pt-3">
        <Text className="text-lg font-semibold text-lantern-text">{COMMUNITY_GATE_COPY.needsProfileTitle}</Text>
        <View className="mt-3 rounded-xl border border-dashed border-lantern-border bg-lantern-surface p-8">
          <Text className="text-center text-sm font-medium text-lantern-text">
            {COMMUNITY_GATE_COPY.needsProfileBody}
          </Text>
          {onBack ? (
            <Pressable
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel={backLabel}
              className="mt-4 items-center"
            >
              <Text className="text-xs font-semibold text-lantern-primary-text">{backLabel}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Screen>
  );
}

export default DiscoverComingSoon;
