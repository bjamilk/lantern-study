/**
 * `TileScene` — the mobile renderer for a room tile's scene.
 *
 * The landscape sibling of `Illustration`. Same contract, same division of
 * labour: the drawing is DATA in `@lantern/shared/design` (`TILE_SCENES`), so
 * this file and the web `<svg>` render the same twelve assets rather than two
 * sets that drift. What this file decides, and nothing else:
 *
 *   - which colours the scene is drawn in (from the theme and the feature
 *     accent, never a hex at a call site);
 *   - how big it is, from the box the tile's panel hands it.
 *
 * Geometry, stroke weight, the viewBox and the shade formula come from the
 * shared module. There is deliberately no `color`, `fill` or `d` prop, for the
 * reason `Illustration` has none: an asset that can be re-coloured per call
 * site is how "identical in both themes from one asset" stops being true.
 *
 * WHY THE INK IS `colors.text` AND NOT THE FEATURE'S. Because that is what the
 * glyph this scene replaces was already drawn in, and this lane changes the
 * picture, not the palette. On the pastel it is the darkest thing in the tile
 * in both themes.
 */
import React from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import {
  TILE_SCENES,
  TILE_SCENE_STROKE_WIDTH,
  type FeatureKey,
  type TileSceneName,
} from '@lantern/shared/design';
import { useTheme } from '../../theme';
import { useFeatureAccent } from './FeatureDisc';
import { tileSceneFills, tileSceneSvgProps } from './tileSceneFills';

export { tileSceneFills, tileSceneSvgProps };
export type { TileSceneName };

export function TileScene({
  scene,
  feature,
  boxWidth,
  boxHeight,
}: {
  scene: TileSceneName;
  /** Whose hue this tile is. Supplies the tint the shade is derived from. */
  feature: FeatureKey;
  /** The panel's width. The scene fits inside this box and centres. */
  boxWidth: number;
  /** The panel's drawable height, once its padding is paid. */
  boxHeight: number;
}) {
  const { colors } = useTheme();
  const accent = useFeatureAccent(feature);
  const asset = TILE_SCENES[scene];
  const svg = tileSceneSvgProps({ boxWidth, boxHeight });
  // `fill` is the SURFACE, never the tile's own pastel: a sheet painted in the
  // ground's hue is invisible against it. `shade` is that pastel carried part
  // of the way toward the feature's ink, so the cast shadow keeps the tile's
  // colour rather than going grey.
  const { fill, shade } = tileSceneFills({
    tint: accent.tint,
    ink: accent.ink,
    surface: colors.surface,
  });

  return (
    <View
      // The picture's box is fixed, never the slack a parent row takes back.
      style={{ width: svg.width, height: svg.height, flexShrink: 0 }}
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={svg.width} height={svg.height} viewBox={svg.viewBox}>
        {asset.paths.map((path, index) => (
          <Path
            // Index is the identity: `paths` is a frozen literal in the shared
            // module, so the list never reorders or grows at runtime.
            key={index}
            d={path.d}
            transform={path.transform}
            fill={path.fill === 'fill' ? fill : path.fill === 'shade' ? shade : 'none'}
            stroke={path.stroke === false ? undefined : colors.text}
            // In viewBox units, so the weight scales with the drawing rather
            // than reading as a marker pen on a small tile and a hairline on a
            // large one.
            strokeWidth={path.stroke === false ? undefined : TILE_SCENE_STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </Svg>
    </View>
  );
}

export default TileScene;
