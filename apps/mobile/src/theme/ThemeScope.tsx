import React, { useMemo } from 'react';
import { View, type ViewProps } from 'react-native';
import { useTheme } from './ThemeContext';
import { darkLanternVars, lightLanternVars } from './lanternCssVars';

/**
 * Re-applies NativeWind CSS vars + `dark` class.
 * Required for Modal/portal content that renders outside ThemeProvider's root View.
 */
export function ThemeScope({ children, style, className, ...rest }: ViewProps) {
  const { isDark } = useTheme();
  const lanternVars = useMemo(() => (isDark ? darkLanternVars : lightLanternVars), [isDark]);

  return (
    <View
      {...rest}
      style={[lanternVars, style]}
      className={`${isDark ? 'dark' : ''} ${className ?? ''}`.trim()}
    >
      {children}
    </View>
  );
}
