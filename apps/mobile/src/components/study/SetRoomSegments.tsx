/**
 * The set room's segment row: `Overview · Materials · Practice · Lectures ·
 * Plan`.
 *
 * It is the fix for the room being one ~7-screen scroll with no jump targets
 * (SF2 mobile evidence §6 item 1). Each segment shows ONE section of content
 * the room already drew; what belongs to which is `setRoomSections.ts`, not
 * this file, which only draws.
 *
 * WHY `useSegmentSkin` AND NOT `Segmented`. `Segmented` splits its options
 * evenly across a fixed box (`flex-1` per item), which at five words on a
 * phone gives `Materials` and `Overview` about 70 px each and truncates both.
 * This row scrolls horizontally instead, so every word is whole at any font
 * scale. The SKIN is still the shared one — ink fill, inverse label, hairline
 * outline when idle — so a set room's segments and the Study hub's are the
 * same object.
 */
import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { T, useSegmentSkin } from '../ui';
import { useTheme } from '../../theme';
import { SET_ROOM_SECTIONS, type SetRoomSectionId } from './setRoomSections';

export interface SetRoomSegmentsProps {
  value: SetRoomSectionId;
  onChange: (id: SetRoomSectionId) => void;
}

export function SetRoomSegments({ value, onChange }: SetRoomSegmentsProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // The row is edge-to-edge inside the screen's own 16 dp padding, so the
      // last segment can scroll clear of the right edge rather than sitting
      // half under it.
      contentContainerStyle={{ gap: 8, paddingRight: 16 }}
      className="mb-3 -mr-4"
      accessibilityRole="tablist"
    >
      {SET_ROOM_SECTIONS.map((section) => (
        <SetRoomSegment
          key={section.id}
          label={section.label}
          accessibilityLabel={section.accessibilityLabel}
          selected={section.id === value}
          onPress={() => onChange(section.id)}
        />
      ))}
    </ScrollView>
  );
}

function SetRoomSegment({
  label,
  accessibilityLabel,
  selected,
  onPress,
}: {
  label: string;
  accessibilityLabel: string;
  selected: boolean;
  onPress: () => void;
}) {
  const skin = useSegmentSkin(selected);
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel}
      style={{
        backgroundColor: skin.backgroundColor,
        borderColor: selected ? skin.backgroundColor : colors.border,
      }}
      className="min-h-[40px] px-4 rounded-full border items-center justify-center"
    >
      <View pointerEvents="none">
        <T.Caption style={{ color: skin.color, fontWeight: '600' }} numberOfLines={1}>
          {label}
        </T.Caption>
      </View>
    </Pressable>
  );
}

export default SetRoomSegments;
