import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import {
  featureAccentsDark,
  featureAccentsLight,
  type FeatureKey,
} from '@lantern/shared/design';
import { useTheme } from '../../theme';
import { APP_ICONS, type AppIconName } from './appIconMap';
import { strokeWidthForSize } from './appIconStroke';
import { resolveIconTone, type AppIconTone } from './appIconTone';

export type { AppIconName };
export { strokeWidthForSize } from './appIconStroke';
export { APP_ICONS, isAppIconName } from './appIconMap';
export {
  resolveIconTone,
  isDuotoneBlob,
  DUOTONE_BLOB_ICONS,
  type AppIconTone,
} from './appIconTone';

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
  /**
   * Spec v3 §5.6 "Icon rule". `neutral` (the default) draws the glyph in
   * `color`. `feature` draws it in `feature`'s ink. `active` draws the duotone
   * current-item form — ink stroke over a tint fill — which is how a bar or a
   * segmented control changes SHAPE for the selected item rather than only
   * hue. Both accented tones need `feature`; see appIconTone.ts for the rule.
   */
  tone?: AppIconTone;
  /** Which of the eight feature identities. Required by `tone` != 'neutral'. */
  feature?: FeatureKey;
  /** Escape hatch. Leave unset so appIconStroke.ts stays the single source. */
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
  /** Screen-reader label, for the rare icon that carries meaning on its own. */
  accessibilityLabel?: string;
  /** `"no"` hides a purely decorative glyph from the accessibility tree. */
  importantForAccessibility?: 'auto' | 'yes' | 'no' | 'no-hide-descendants';
  testID?: string;
}

function renderGlyph({
  name,
  size,
  stroke,
  fill,
  strokeWidth,
  style,
  accessibilityLabel,
  importantForAccessibility,
}: {
  name: AppIconName;
  size: number;
  stroke: string;
  fill: string | null;
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  importantForAccessibility?: AppIconProps['importantForAccessibility'];
}) {
  const Glyph = APP_ICONS[name];
  return (
    <Glyph
      size={size}
      color={stroke}
      // lucide paints `fill: none` by default. A solid glyph is the same path
      // filled in its own stroke colour — `currentColor` is the fallback for
      // the handful of call sites that inherit their colour.
      fill={fill ?? 'none'}
      strokeWidth={strokeWidth ?? strokeWidthForSize(size)}
      absoluteStrokeWidth={false}
      style={style}
      accessibilityLabel={accessibilityLabel}
      importantForAccessibility={importantForAccessibility}
    />
  );
}

/**
 * The accented half, split out so the plain path stays hook-free.
 *
 * `useTheme` THROWS outside a ThemeProvider, and AppIcon is drawn by a few
 * surfaces that mount before the providers do. Keeping the hook in a child
 * that only a `tone` prop can reach means a neutral icon never touches the
 * theme context at all.
 */
function TonedAppIcon({
  name,
  size = APP_ICON_DEFAULT_SIZE,
  color,
  tone = 'neutral',
  feature,
  strokeWidth,
  style,
  accessibilityLabel,
  importantForAccessibility,
  testID,
}: AppIconProps) {
  const { isDark } = useTheme();
  const accent = feature ? (isDark ? featureAccentsDark : featureAccentsLight)[feature] : null;
  const paint = resolveIconTone(tone, accent, color, name);

  const glyph = renderGlyph({
    name,
    size,
    stroke: paint.stroke,
    fill: paint.fill,
    strokeWidth,
    style: paint.disc ? undefined : style,
    accessibilityLabel,
    importantForAccessibility,
  });

  // The fallback for a glyph a fill would flatten: the same two-tone weight,
  // carried by a disc behind the outline instead of by the outline itself.
  if (paint.disc) {
    const box = Math.round(size * 1.5);
    return (
      <View
        testID={testID}
        style={[
          {
            width: box,
            height: box,
            borderRadius: box / 3,
            backgroundColor: paint.disc,
            alignItems: 'center',
            justifyContent: 'center',
          },
          style,
        ]}
        importantForAccessibility="no-hide-descendants"
      >
        {glyph}
      </View>
    );
  }

  if (testID) {
    return <View testID={testID}>{glyph}</View>;
  }
  return glyph;
}

/**
 * The app's only icon primitive.
 *
 * Which glyph, how heavy its stroke, whether it is filled, which tone it
 * carries — all decided here, so "make the icons bolder" is one edit rather
 * than seven hundred.
 */
export function AppIcon(props: AppIconProps) {
  const {
    name,
    size = APP_ICON_DEFAULT_SIZE,
    color,
    filled = false,
    tone = 'neutral',
    strokeWidth,
    style,
    accessibilityLabel,
    importantForAccessibility,
    testID,
  } = props;

  if (tone !== 'neutral') {
    return <TonedAppIcon {...props} />;
  }

  const glyph = renderGlyph({
    name,
    size,
    stroke: color ?? 'currentColor',
    fill: filled ? color ?? 'currentColor' : null,
    strokeWidth,
    style,
    accessibilityLabel,
    importantForAccessibility,
  });

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
