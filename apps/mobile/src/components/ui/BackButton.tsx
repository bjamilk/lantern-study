import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { type StyleProp, type ViewStyle } from 'react-native';
import { IconButton } from './IconButton';
import { useTheme } from '../../theme';

/**
 * THE back button (founder request 2026-08-29: back affordances across the
 * app were missing, text-glyph tiny, or under-sized). One component so every
 * screen gets the same thing: a 26pt arrow inside IconButton's guaranteed
 * 44pt target with the accessibility contract, wired to navigation.goBack by
 * default. Screens with custom back behaviour pass onPress.
 */
export function BackButton({
  onPress,
  color,
  label = 'Go back',
  size = 26,
  style,
}: {
  onPress?: () => void;
  color?: string;
  label?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const handlePress =
    onPress ??
    (() => {
      if (navigation.canGoBack()) navigation.goBack();
    });

  return (
    <IconButton
      icon="arrow-back"
      accessibilityLabel={label}
      onPress={handlePress}
      size={size}
      padding={9}
      color={color || colors.textSecondary}
      style={style}
    />
  );
}

export default BackButton;
