import React from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';

/** Apple's and Android's minimum comfortable target. */
const MIN_TARGET = 44;

interface IconButtonProps {
  icon: keyof typeof Ionicons.glyphMap;
  /**
   * Required, and deliberately so. An icon-only control is invisible to a
   * screen reader without it, and every unlabelled icon button in this codebase
   * got that way by the label simply being optional.
   */
  accessibilityLabel: string;
  onPress?: () => void;
  size?: number;
  color?: string;
  disabled?: boolean;
  selected?: boolean;
  /** Visual footprint. The touch target stays at least 44pt regardless. */
  padding?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Icon-only button with the accessibility contract baked in: a required label,
 * a button role, disabled/selected state, and a touch target padded out to
 * 44pt via hitSlop when the visual is smaller.
 *
 * `hitSlop` appeared exactly once in the entire chat surface before this.
 */
export function IconButton({
  icon,
  accessibilityLabel,
  onPress,
  size = 22,
  color,
  disabled = false,
  selected = false,
  padding = 8,
  style,
  testID,
}: IconButtonProps) {
  const { colors } = useTheme();
  const visual = size + padding * 2;
  const slop = Math.max(0, Math.ceil((MIN_TARGET - visual) / 2));

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      hitSlop={slop}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: disabled || !onPress, selected }}
      style={[{ opacity: disabled ? 0.4 : 1 }, style]}
    >
      <View
        style={{
          width: visual,
          height: visual,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 10,
          backgroundColor: selected ? colors.primaryBackground : 'transparent',
        }}
      >
        <Ionicons name={icon} size={size} color={color || colors.text} />
      </View>
    </Pressable>
  );
}

export default IconButton;
