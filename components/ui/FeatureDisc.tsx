import React from 'react';
import { FEATURE_PANEL_INK_TEXT, FEATURE_TINT_BG, type FeatureKey } from './featureClasses';

/** 40 = tile mark, 32 = row mark, 24 = dense list mark. No other size — the
 *  same three the mobile `FeatureDisc` takes, so a row is the same object on
 *  both platforms. */
export type FeatureDiscSize = 40 | 32 | 24;

export interface FeatureDiscProps {
  /** Which feature this object belongs to. Hue = identity, never state. */
  feature: FeatureKey;
  /** The glyph. Sized by the caller's icon component; stroke stays as shipped. */
  icon: React.ReactNode;
  size?: FeatureDiscSize;
  className?: string;
}

/**
 * Rounded SQUARES, not circles, since the 2026-09-11 StudyFetch pass: the
 * reference draws every type-icon tile as a squircle, and a square tile beside
 * a square thumbnail lines up where a circle floats. The radii are ~35% of the
 * edge, which is the corner the reference uses at every size.
 */
const sizeClasses: Record<FeatureDiscSize, string> = {
  40: 'w-10 h-10 rounded-[14px]',
  32: 'w-8 h-8 rounded-[11px]',
  24: 'w-6 h-6 rounded-lg',
};

/**
 * A pastel tile with a BLACK line glyph — the Tier 1 container from §5.6, in
 * the anatomy the 2026-09-11 direction specifies.
 *
 * The glyph was the feature's ink and is now the theme's ink
 * (`FEATURE_PANEL_INK_TEXT`): on the reference, the pastel carries the
 * identity and the mark is always drawn in flat black, which is what stops a
 * list of nine object types reading as nine different mid-tone smudges. The
 * pairing inverts in dark, where the tile is a near-black and a flat-black
 * mark would be invisible.
 *
 * This is still the only colour a typed list row is allowed: the row itself
 * stays neutral, the tile says what kind of object it is. It is decorative by
 * construction (`aria-hidden`); the row's own text carries the meaning, so a
 * screen reader never hears "teal square".
 */
export const FeatureDisc: React.FC<FeatureDiscProps> = ({
  feature,
  icon,
  size = 40,
  className = '',
}) => (
  <span
    aria-hidden="true"
    className={`shrink-0 inline-flex items-center justify-center ${sizeClasses[size]} ${FEATURE_TINT_BG[feature]} ${FEATURE_PANEL_INK_TEXT[feature]} ${className}`}
  >
    {icon}
  </span>
);

export default FeatureDisc;
