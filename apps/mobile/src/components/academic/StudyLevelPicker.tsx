/**
 * Segmented "100 level … 700 level" chooser shared by SignUp, the
 * profile-setup modal and Academic settings.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { STUDY_LEVELS, studyLevelLabel } from '@lantern/shared/academic';
import { useTheme } from '../../theme';

/** Sign-up / settings offer 100–700; 800/900 stay valid server-side for postgrads. */
export const PICKABLE_STUDY_LEVELS: readonly number[] = STUDY_LEVELS.filter(level => level <= 700);

interface StudyLevelPickerProps {
  value: number | null | undefined;
  onChange: (level: number) => void;
  levels?: readonly number[];
  disabled?: boolean;
  accessibilityLabel?: string;
}

export function StudyLevelPicker({
  value,
  onChange,
  levels = PICKABLE_STUDY_LEVELS,
  disabled = false,
  accessibilityLabel = 'Study level',
}: StudyLevelPickerProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
      {levels.map(level => {
        const selected = value === level;
        return (
          <Pressable
            key={level}
            onPress={() => onChange(level)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled }}
            accessibilityLabel={studyLevelLabel(level)}
            style={[
              styles.chip,
              {
                backgroundColor: selected ? colors.primary : colors.inputBackground,
                borderColor: selected ? colors.primary : colors.inputBorder,
                opacity: disabled ? 0.6 : 1,
              },
            ]}
          >
            <Text style={[styles.chipText, { color: selected ? colors.textInverse : colors.text }]}>{level}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    minWidth: 56,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
  },
});

export default StudyLevelPicker;
