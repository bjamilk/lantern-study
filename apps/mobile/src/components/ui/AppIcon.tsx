import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { APP_ICONS, type AppIconName } from './appIconMap';
import { strokeWidthForSize } from './appIconStroke';

export type { AppIconName };
export { strokeWidthForSize } from './appIconStroke';
export { APP_ICONS, isAppIconName } from './appIconMap';

/** Matches the call sites this replaced, which overwhelmingly drew at 24. */
export const APP_ICON_DEFAULT_SIZE = 24;

export interface AppIconProps {
  name: AppIconName;
  /**
   * Raw pixels, passed straight to lucide. Never a NativeWind class: rem is
   * inlined at 14 in this app, so `h-6` would be 21px, not 24px.
   */
  size?: number;
  color?: string;
  /**
   * Paints the glyph solid in its own colour. This is how every old
   * `x` / `x-outline` STATE pair collapses to a single name: a saved bookmark
   * is `name="bookmark" filled`, an unsaved one is the same name without it.
   *
   * Not every old pair was a fill state. `checkbox`/`square`,
   * `radio-button-on`/`radio-button-off`, `checkmark-circle`/`ellipse` and
   * `checkmark-done`/`checkmark` are genuinely different glyphs and stay two
   * names.
   */
  filled?: boolean;
  /** Escape hatch. Leave unset so appIconStroke.ts stays the single source. */
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
  /** Screen-reader label, for the rare icon that carries meaning on its own. */
  accessibilityLabel?: string;
  /** `"no"` hides a purely decorative glyph from the accessibility tree. */
  importantForAccessibility?: 'auto' | 'yes' | 'no' | 'no-hide-descendants';
  testID?: string;
}

/**
 * The app's only icon primitive.
 *
 * Which glyph, how heavy its stroke, whether it is filled — all decided here,
 * so "make the icons bolder" is one edit rather than seven hundred.
 */
export function AppIcon({
  name,
  size = APP_ICON_DEFAULT_SIZE,
  color,
  filled = false,
  strokeWidth,
  style,
  accessibilityLabel,
  importantForAccessibility,
  testID,
}: AppIconProps) {
  const Glyph = APP_ICONS[name];
  const glyph = (
    <Glyph
      size={size}
      color={color}
      // lucide paints `fill: none` by default. A solid glyph is the same path
      // filled in its own stroke colour — `currentColor` is the fallback for
      // the handful of call sites that inherit their colour.
      fill={filled ? color ?? 'currentColor' : 'none'}
      strokeWidth={strokeWidth ?? strokeWidthForSize(size)}
      absoluteStrokeWidth={false}
      style={style}
      accessibilityLabel={accessibilityLabel}
      importantForAccessibility={importantForAccessibility}
    />
  );

  // lucide's Icon swallows `testID` and re-emits it as the web-only
  // `data-testid`, which React Native queries cannot see. A wrapper is the only
  // way to make the prop mean what it says; it is added ONLY when a test asks
  // for one, so no production tree grows a node it did not have before.
  if (testID) {
    return <View testID={testID}>{glyph}</View>;
  }
  return glyph;
}

export default AppIcon;
