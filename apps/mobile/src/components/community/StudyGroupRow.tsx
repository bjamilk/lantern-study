import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { studyGroupSubtitle, type CommunityStudyGroup } from '@lantern/shared/network';
import { AppIcon } from '../ui/AppIcon';

/**
 * A study group listed on a community page but living in Chat (§7).
 *
 * The `→` glyph is the promise the subtitle makes: tapping this row changes
 * tab. The move is shown, not inferred — that is the whole
 * no-silent-disappearance contract, expressed as a row.
 */
export function StudyGroupRow({
  group,
  busy,
  onPress,
}: {
  group: CommunityStudyGroup;
  busy?: boolean;
  onPress: () => void;
}) {
  const subtitle = studyGroupSubtitle(group);
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={`${group.name}, ${subtitle}`}
      accessibilityState={{ disabled: !!busy, busy: !!busy }}
      className={`flex-row items-center px-4 min-h-[52px] active:bg-lantern-background-secondary ${
        group.isMember ? '' : 'opacity-70'
      }`}
      style={busy ? { opacity: 0.5 } : undefined}
    >
      <View className="w-5 items-center">
        <AppIcon name="school" size={16} color="#94a3b8" />
      </View>
      <View className="flex-1 min-w-0 ml-1">
        <Text className="text-[15px] font-medium text-lantern-text" numberOfLines={1}>
          {group.name}
        </Text>
        <Text className="text-xs text-lantern-text-tertiary mt-0.5" numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <AppIcon name="arrow-forward" size={14} color="#94a3b8" />
    </Pressable>
  );
}

export default StudyGroupRow;
