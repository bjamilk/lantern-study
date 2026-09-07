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
   * The band's content — a glyph or spot illustration. Rendered inside a 56 px
   * tint strip across the top of the card, above `children`. Without it a
   * `feature` card is simply a neutral card.
   */
  band?: React.ReactNode;
  /** Right-aligned inside the band: the count pill ("12 due", "3 saved"). */
  bandTrailing?: React.ReactNode;
}

const variantClasses: Record<CardVariant, string> = {
  default: 'bg-lantern-surface/95 border border-lantern-border shadow-lantern backdrop-blur-[2px]',
  elevated: 'bg-lantern-surface border border-lantern-border shadow-lantern-md',
  outline: 'bg-transparent border border-lantern-border',
  // A door tile: neutral card at rest, no shadow, the colour lives in the band.
  feature: 'bg-lantern-surface border border-lantern-border',
};

const paddingClasses = {
  none: '',
  sm: 'p-3',
  md: 'p-4 md:p-5',
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
      className={`rounded-lantern-xl ${variantClasses[variant]} ${outerPadding} ${interactive} ${className}`}
    >
      {hasBand ? (
        <>
          <div
            className={`flex h-8 items-center justify-between gap-3 px-4 ${FEATURE_TINT_BG[feature!]} ${FEATURE_INK_TEXT[feature!]}`}
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
