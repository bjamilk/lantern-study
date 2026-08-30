/**
 * "First / Second semester" chooser shared by SignUp, the profile-setup modal
 * and Academic settings — the level alone never said which half of the year a
 * student is actually sitting.
 *
 * Deliberately clearable: semester is optional on the profile, so tapping the
 * selected chip unsets it (there is no third "Not set" chip to mis-tap).
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { semesterOptions, type CourseSemester } from '@lantern/shared/academic';
import { useTheme } from '../../theme';

interface SemesterPickerProps {
  value: 1 | 2 | null | undefined;
  onChange: (semester: 1 | 2 | null) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}

export function SemesterPicker({
  value,
  onChange,
  disabled = false,
  accessibilityLabel = 'Current semester',
}: SemesterPickerProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
      {semesterOptions().map((option: { value: CourseSemester; label: string }) => {
        const selected = value === option.value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(selected ? null : option.value)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled }}
            accessibilityLabel={option.label}
            accessibilityHint={selected ? 'Tap again to clear' : undefined}
            style={[
              styles.chip,
              {
                backgroundColor: selected ? colors.primary : colors.inputBackground,
                borderColor: selected ? colors.primary : colors.inputBorder,
                opacity: disabled ? 0.6 : 1,
              },
            ]}
          >
            <Text
              style={[styles.chipText, { color: selected ? colors.textInverse : colors.text }]}
            >
              {option.label}
            </Text>
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
    minHeight: 44,
    paddingHorizontal: 14,
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

export default SemesterPicker;
