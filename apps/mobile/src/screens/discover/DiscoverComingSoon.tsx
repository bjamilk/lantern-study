import React from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  DISCOVER_COMING_SOON_BODY,
  DISCOVER_COMING_SOON_TITLE,
} from '@lantern/shared/network';
import { Screen } from '../../components/layout';

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
        <Text className="text-lg font-semibold text-lantern-text">{DISCOVER_COMING_SOON_TITLE}</Text>
        <View className="mt-3 rounded-xl border border-dashed border-lantern-border bg-lantern-surface p-8">
          <Text className="text-center text-sm font-medium text-lantern-text">
            {DISCOVER_COMING_SOON_BODY}
          </Text>
          {onBack ? (
            <Pressable
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel={backLabel}
              className="mt-4 items-center"
            >
              <Text className="text-xs font-semibold text-lantern-primary">{backLabel}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Screen>
  );
}

export default DiscoverComingSoon;
