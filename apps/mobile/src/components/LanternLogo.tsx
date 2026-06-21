import React from 'react';
import { Image, ImageStyle, StyleProp } from 'react-native';

const logoSource = require('../../assets/lantern-icon.png');

interface LanternLogoProps {
  size?: number;
  style?: StyleProp<ImageStyle>;
}

export function LanternLogo({ size = 64, style }: LanternLogoProps) {
  return (
    <Image
      source={logoSource}
      style={[{ width: size, height: size, borderRadius: size * 0.22 }, style]}
      accessibilityLabel="Lantern Study"
    />
  );
}
