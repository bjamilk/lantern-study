import React from 'react';
import {
  ILLUSTRATIONS,
  ILLUSTRATION_STROKE_WIDTH,
  illustrationViewBox,
  type IllustrationName,
} from '@lantern/shared/design';
import { FEATURE_INK_TEXT, FEATURE_TINT_FILL, type FeatureKey } from './featureClasses';

export type { IllustrationName };

export interface IllustrationProps {
  /**
   * One of the ten (`packages/shared/src/design/illustrations`). The union is
   * the map's key type, so a name that is not drawn is a compile error here —
   * §5.6's "unmapped name = compile error", enforced by the type rather than
   * by a lint anyone can silence.
   */
  name: IllustrationName;
  /** Whose hue this is. Sets `currentColor` (the ink) and the ground's tint. */
  feature: FeatureKey;
  /** Rendered edge length in px. The asset is a square; callers scale, never re-author. */
  size?: number;
  /**
   * An accessible name, when the drawing carries meaning no adjacent text
   * carries. Omit it — the usual case — and the SVG is `aria-hidden`, because a
   * spot illustration beside its own title is decoration and announcing it
   * twice is worse than not announcing it.
   */
  title?: string;
  className?: string;
}

/**
 * The web renderer for a shared spot illustration (§5.6 "Imagery rule").
 *
 * The asset is pure data in `@lantern/shared/design`; mobile draws the same
 * record with `react-native-svg`. Nothing here chooses geometry, so the two
 * platforms cannot drift, and nothing here names a light or dark value, so the
 * two themes come out of one asset:
 *
 *   - Every path is stroked in `currentColor` at stroke 2. `currentColor` is
 *     set by `FEATURE_INK_TEXT[feature]` on the `<svg>` — a Tailwind class, so
 *     it resolves through `--color-feature-<key>-ink`, which `:root` and
 *     `.dark` define differently. One class, two themes.
 *   - Exactly one filled shape: the ground ellipse, in
 *     `--color-feature-<key>-tint`. It is drawn first, so it sits behind the
 *     drawing, and it is never stroked.
 *
 * The viewBox is the asset's own ink bounds (`illustrationViewBox`), not the
 * authored 96-square it is drawn inside: each drawing sits in the middle of
 * that square with a quarter to a half of it as padding, so rendering the full
 * square made the picture about two thirds of the box the call site asked for.
 * The crop is shared data, so web and mobile frame the ten drawings
 * identically.
 *
 * On a surface the ground reads as the shadow the subject stands on. Inside a
 * tint band it is the same colour as its background and therefore invisible —
 * which is correct, not a bug: the band already *is* the ground. The asset does
 * not change to suit the container, so the door on a hub and the empty state on
 * a list are provably the same drawing.
 *
 * Nothing is fetched. These are string literals compiled into the bundle, so
 * `lowDataMode` changes nothing about them.
 */
export const Illustration: React.FC<IllustrationProps> = ({
  name,
  feature,
  size = 56,
  title,
  className = '',
}) => {
  const { paths, ground } = ILLUSTRATIONS[name];

  return (
    <svg
      viewBox={illustrationViewBox(name)}
      width={size}
      height={size}
      className={`shrink-0 ${FEATURE_INK_TEXT[feature]} ${className}`}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <ellipse
        cx={ground.cx}
        cy={ground.cy}
        rx={ground.rx}
        ry={ground.ry}
        className={FEATURE_TINT_FILL[feature]}
        stroke="none"
      />
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={ILLUSTRATION_STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {paths.map((d, i) => (
          // Index keys: two columns of the same building are the same `d`, and
          // the list is a constant — it never reorders.
          <path key={`${name}-${i}`} d={d} />
        ))}
      </g>
    </svg>
  );
};

export default Illustration;
