/**
 * `Illustration` — the mobile renderer for the ten spot illustrations.
 *
 * Spec v3 §5.6 "Imagery rule". The drawing itself is DATA, in
 * `@lantern/shared/design` (`ILLUSTRATIONS`), so web and mobile render the
 * same asset instead of two pictures that drift. This file is only the
 * react-native-svg half: it turns a name plus a feature key into strokes in
 * that feature's ink over one tint-filled ground ellipse.
 *
 * WHAT THIS COMPONENT IS ALLOWED TO DECIDE, and nothing else:
 *
 *   - which two colours the asset is drawn in (from `featureAccents*`, never
 *     a hex at a call site);
 *   - how big it is (56 / 72 / 96, and no other size);
 *   - which of the two colours fills the ground ellipse (`variant`).
 *
 * Geometry, stroke weight and the viewBox come from the shared module. There
 * is deliberately no `color`, `stroke` or `d` prop: an asset that can be
 * re-coloured per call site is how "identical in both themes from one asset"
 * stops being true.
 *
 * `IllustrationName` is a closed union in the shared module, so an unmapped
 * name is a compile error here and at every call site — which is the
 * "enumerated in an illustration map" half of the rule.
 *
 * WHERE IT MAY APPEAR (§5.7): doors, tiles, empty states, heroes. Never in a
 * list row and never on a reading surface — a picture beside every item is
 * the rainbow-noise failure §5.8 names, and a picture next to prose competes
 * with the prose.
 */
import React from 'react';
import { View } from 'react-native';
import Svg, { Ellipse, Path } from 'react-native-svg';
import {
  ILLUSTRATIONS,
  ILLUSTRATION_STROKE_WIDTH,
  featureAccentsDark,
  featureAccentsLight,
  type FeatureKey,
  type IllustrationName,
} from '@lantern/shared/design';
import { useTheme } from '../../theme';
import {
  ILLUSTRATION_CONTENT_BOXES,
  ILLUSTRATION_FRAME_MARGIN,
  ILLUSTRATION_SIZES,
  illustrationFills,
  illustrationSvgProps,
  illustrationViewBox,
  type IllustrationContentBox,
  type IllustrationSize,
  type IllustrationVariant,
} from './illustrationFills';

// The sizes and the ground inversion live in a pure module beside this one so
// they can be unit-tested without a renderer (the same split `AppIcon` makes
// with `appIconStroke.ts`); the per-asset ink boxes live in
// `@lantern/shared/design` beside the geometry, so web frames the same ten
// drawings. Re-exported here because this is where callers look.
export {
  ILLUSTRATION_CONTENT_BOXES,
  ILLUSTRATION_FRAME_MARGIN,
  ILLUSTRATION_SIZES,
  illustrationFills,
  illustrationSvgProps,
  illustrationViewBox,
  type IllustrationContentBox,
  type IllustrationSize,
  type IllustrationVariant,
};

export function Illustration({
  name,
  feature,
  size = 72,
  variant = 'tint',
  accessibilityLabel,
}: {
  name: IllustrationName;
  feature: FeatureKey;
  size?: IllustrationSize;
  variant?: IllustrationVariant;
  /**
   * Only when the picture carries meaning no adjacent text repeats — which on
   * a door or an empty state it never does, because the title says it. Left
   * off, the whole thing is hidden from the screen reader rather than read out
   * as an unnamed image.
   */
  accessibilityLabel?: string;
}) {
  const { colors, isDark } = useTheme();
  const accent = (isDark ? featureAccentsDark : featureAccentsLight)[feature];
  const asset = ILLUSTRATIONS[name];
  // `width`, `height` and the viewBox are DATA, not layout: the box is the
  // size the call site asked for, and the viewBox is this asset's own ink
  // bounds rather than the authored 96-square it is drawn inside. Before the
  // crop a 56 dp tile picture drew ~32 dp of ink and read as an icon (build
  // 166 device pass, D2) — the box was already 56, the drawing inside it was
  // not.
  const svg = illustrationSvgProps(name, size);
  const { stroke, ground } = illustrationFills({
    ink: accent.ink,
    tint: accent.tint,
    surface: colors.surface,
    variant,
  });
  return (
    <View
      // `flexShrink: 0`: the picture's box is a fixed square, never the slack
      // a parent row takes back. Without it a tile whose promise wraps could
      // squeeze the drawing instead of growing.
      style={{ width: size, height: size, flexShrink: 0 }}
      accessible={Boolean(accessibilityLabel)}
      accessibilityRole={accessibilityLabel ? 'image' : undefined}
      accessibilityLabel={accessibilityLabel}
      importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'}
    >
      <Svg width={svg.width} height={svg.height} viewBox={svg.viewBox}>
        {/* The one filled shape in the asset, drawn first so every stroke
            crosses it rather than hides under it. Never stroked. */}
        <Ellipse
          cx={asset.ground.cx}
          cy={asset.ground.cy}
          rx={asset.ground.rx}
          ry={asset.ground.ry}
          fill={ground}
        />
        {asset.paths.map((d, i) => (
          <Path
            // Index is the identity here: `paths` is a frozen literal in the
            // shared module, so the list never reorders or grows at runtime.
            key={i}
            d={d}
            fill="none"
            stroke={stroke}
            // In viewBox units, so the weight scales with the drawing — a
            // monoline that stayed 2dp at every size would read as a marker
            // pen at 56 and a hairline at 96 relative to its own geometry.
            strokeWidth={ILLUSTRATION_STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </Svg>
    </View>
  );
}

export default Illustration;
