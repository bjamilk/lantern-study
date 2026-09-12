import React from 'react';
import {
  FEATURE_INK_TEXT,
  FEATURE_TINT_BG,
  type FeatureKey,
} from './featureClasses';

type CardVariant = 'default' | 'elevated' | 'outline' | 'feature';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  variant?: CardVariant;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  onClick?: () => void;
  /**
   * Which feature this card belongs to. Only read by `variant="feature"`; it
   * colours the band and the band glyph — and nothing else. Hue = identity at
   * rest, never state (§5.6), and never an outline (§5.8).
   */
  feature?: FeatureKey;
  /**
   * The band's content — the feature's glyph, and nothing taller. Rendered
   * inside the 32 px tint strip across the top of the card, above `children`.
   * Without it a `feature` card is simply a neutral card.
   *
   * A spot illustration does NOT go here: see `BAND_HEIGHT_CLASS`.
   */
  band?: React.ReactNode;
  /** Right-aligned inside the band: the count pill ("12 due", "3 saved"). */
  bandTrailing?: React.ReactNode;
}

/**
 * The band is 32 px, and there is no second size.
 *
 * §5.6 caps a card at 25% tint. A door's body is ~100 px (p-4, a 24 px heading,
 * an 18 px caption, and the chevron row), so 32/132 ≈ 24% — just inside. A band
 * grown to 56 px to hold a spot illustration puts the same tile at 56/132 ≈ 42%,
 * which is why `DoorTile` draws its illustration in the BODY, on the chevron's
 * row, exactly as mobile's `FeatureTile` does. The picture there costs no tint
 * at all (its only filled shape is a ~180 px² ground ellipse) and the extra
 * height it brings takes the tile DOWN to ~19%.
 */
const BAND_HEIGHT_CLASS = 'h-8';

const variantClasses: Record<CardVariant, string> = {
  default: 'bg-lantern-surface/95 border border-lantern-border shadow-lantern backdrop-blur-[2px]',
  elevated: 'bg-lantern-surface border border-lantern-border shadow-lantern-md',
  outline: 'bg-transparent border border-lantern-border',
  // A door tile: neutral card at rest, no shadow, the colour lives in the band.
  feature: 'bg-lantern-surface border border-lantern-border',
};

/**
 * 20 px is the `md` step since the 2026-09-11 pass — the reference gives a card
 * noticeably more breathing room than the old 16/20 responsive pair, and the
 * pair itself was a hedge: a card that needs a tighter inset on a phone is a
 * card with too much in it. `sm` and `lg` bracket it for dense rows and hero
 * panels.
 */
const paddingClasses = {
  none: '',
  sm: 'p-3',
  md: 'p-5',
  lg: 'p-6',
};

export const Card: React.FC<CardProps> = ({
  children,
  className = '',
  variant = 'default',
  padding = 'md',
  onClick,
  feature,
  band,
  bandTrailing,
}) => {
  const Tag = onClick ? 'button' : 'div';
  const isFeature = variant === 'feature' && !!feature;
  const hasBand = isFeature && band !== undefined && band !== null;

  // With a band the padding moves inside, so the tint reaches the card's edges.
  const outerPadding = hasBand ? 'overflow-hidden' : paddingClasses[padding];
  const interactive = onClick
    ? `text-left w-full transition-all duration-200 ${
        isFeature
          ? // §5.8 bans coloured outlines: the hue lives in the band, so hover
            // moves the NEUTRAL border and lifts the card instead of ringing it
            // in the feature ink.
            'hover:border-lantern-text-tertiary hover:shadow-lantern'
          : 'hover:border-lantern-primary/40 hover:shadow-lantern-md'
      }`
    : '';

  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      // 16 px (`--radius-lg`), not 20: the reference's cards are squarer than
      // Lantern's were, and the softer corner is what made a white card on a
      // near-white ground read as a bubble rather than a sheet.
      className={`rounded-lantern ${variantClasses[variant]} ${outerPadding} ${interactive} ${className}`}
    >
      {hasBand ? (
        <>
          <div
            className={`flex ${BAND_HEIGHT_CLASS} items-center justify-between gap-3 px-4 ${FEATURE_TINT_BG[feature!]} ${FEATURE_INK_TEXT[feature!]}`}
          >
            <span aria-hidden="true" className="flex items-center">
              {band}
            </span>
            {bandTrailing}
          </div>
          <div className={paddingClasses[padding]}>{children}</div>
        </>
      ) : (
        children
      )}
    </Tag>
  );
};

export default Card;
