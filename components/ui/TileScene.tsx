import React from 'react';
import {
  TILE_SCENES,
  TILE_SCENE_STROKE_WIDTH,
  type TileSceneName,
} from '@lantern/shared/design';
import { FEATURE_PANEL_INK_TEXT, FEATURE_TILE_SCENE_VARS, type FeatureKey } from './featureClasses';

export type { TileSceneName };

export interface TileSceneProps {
  /** One of the twelve (`packages/shared/src/design/illustrations/tileScenes.ts`). */
  scene: TileSceneName;
  /** Whose hue this tile is. Sets the ink, the body fill and the shade. */
  feature: FeatureKey;
  /**
   * The drawing's height in px. The scene is 4:3 and is fitted with
   * `xMidYMid meet`, so it centres inside whatever box it is given and a
   * narrow card letterboxes rather than clips.
   */
  height?: number;
  className?: string;
}

/**
 * The web renderer for a room tile's scene — the drawing that fills a tile's
 * pastel header block.
 *
 * It is the landscape sibling of `Illustration`, and the differences are all
 * in the asset rather than here (see `tileScenes.ts` for why they cannot be
 * one record). What this file is responsible for is the same short list
 * `Illustration` is responsible for, and nothing more:
 *
 *   - The ink is `currentColor`, set by `FEATURE_PANEL_INK_TEXT[feature]` —
 *     the page's strong ink on the pastel in light, the feature's own ink on
 *     the near-black that panel becomes in dark. That is the pairing the tile's
 *     glyph already used, so replacing the glyph with a scene changes the
 *     picture and not the palette.
 *   - The two fills arrive as CSS VARIABLES, never literals, so both themes
 *     come out of one asset. `--tile-fill` is the surface the bodies are
 *     painted; `--tile-shade` is the cast shadow, the tile's own hue pushed
 *     toward its ink. Both carry an inline fallback so a scene still draws if
 *     the variables are ever missing — a blank pastel panel reads as a
 *     failed load, and that is the failure worth spending eight characters on.
 *
 * DECORATIVE, ALWAYS. A tile's scene sits directly above that tile's own
 * label, so a name here would be the label read twice. There is deliberately
 * no `title` prop: `Illustration` has one because an empty-state hero can be
 * the only thing on the screen, and a tile's picture never is.
 */
export const TileScene: React.FC<TileSceneProps> = ({
  scene,
  feature,
  height = 104,
  className = '',
}) => {
  const { viewBox, paths } = TILE_SCENES[scene];

  return (
    <svg
      viewBox={viewBox}
      height={height}
      width={(height * 4) / 3}
      preserveAspectRatio="xMidYMid meet"
      style={FEATURE_TILE_SCENE_VARS[feature] as React.CSSProperties}
      className={`max-w-full shrink-0 ${FEATURE_PANEL_INK_TEXT[feature]} ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((path, index) => (
        // Index keys: `paths` is a frozen literal in the shared module, so the
        // list never reorders and never grows at runtime.
        <path
          key={`${scene}-${index}`}
          d={path.d}
          transform={path.transform}
          fill={
            path.fill === 'fill'
              ? 'var(--tile-fill, #ffffff)'
              : path.fill === 'shade'
                ? 'var(--tile-shade, #bfd3d4)'
                : 'none'
          }
          stroke={path.stroke === false ? 'none' : 'currentColor'}
          strokeWidth={path.stroke === false ? undefined : TILE_SCENE_STROKE_WIDTH}
          strokeLinecap={path.stroke === false ? undefined : 'round'}
          strokeLinejoin={path.stroke === false ? undefined : 'round'}
        />
      ))}
    </svg>
  );
};

export default TileScene;
