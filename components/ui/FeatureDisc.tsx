import React from 'react';
import { FEATURE_INK_TEXT, FEATURE_TINT_BG, type FeatureKey } from './featureClasses';

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

const sizeClasses: Record<FeatureDiscSize, string> = {
  40: 'w-10 h-10 rounded-[14px]',
  32: 'w-8 h-8 rounded-[11px]',
  24: 'w-6 h-6 rounded-lg',
};

/**
 * A tint disc with an ink glyph — the Tier 1 container from §5.6.
 *
 * This is the only colour a typed list row is allowed: the row itself stays
 * neutral, the disc says what kind of object it is. It is decorative by
 * construction (`aria-hidden`); the row's own text carries the meaning, so a
 * screen reader never hears "teal circle".
 */
export const FeatureDisc: React.FC<FeatureDiscProps> = ({
  feature,
  icon,
  size = 40,
  className = '',
}) => (
  <span
    aria-hidden="true"
    className={`shrink-0 inline-flex items-center justify-center ${sizeClasses[size]} ${FEATURE_TINT_BG[feature]} ${FEATURE_INK_TEXT[feature]} ${className}`}
  >
    {icon}
  </span>
);

export default FeatureDisc;
