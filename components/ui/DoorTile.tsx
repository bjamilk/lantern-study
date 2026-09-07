import React from 'react';
import { ChevronRightIcon } from '@heroicons/react/24/outline';
import { Card } from './Card';
import { FEATURE_INK_TEXT, type FeatureKey } from './featureClasses';

export interface DoorTileProps {
  feature: FeatureKey;
  /** The band glyph. Size it at the call site (`w-6 h-6`). */
  icon: React.ReactNode;
  title: string;
  /** One line, a promise rather than a description of the screen behind it. */
  promise: string;
  /** Count pill in the band: "12 due", "3 saved". Omitted when there is nothing to count. */
  count?: string;
  onClick: () => void;
  className?: string;
}

/**
 * A door: neutral card, feature-tint band with a glyph and a count, a one-line
 * promise, and a chevron in the feature's ink (§5.6 "Feature tile").
 *
 * Four to five on a hub and nowhere else. A door that turns up on every screen
 * has stopped being a door and is just decoration with a link in it.
 */
export const DoorTile: React.FC<DoorTileProps> = ({
  feature,
  icon,
  title,
  promise,
  count,
  onClick,
  className = '',
}) => (
  <Card
    variant="feature"
    feature={feature}
    padding="md"
    onClick={onClick}
    className={className}
    band={icon}
    // `caption` (13 px), not `label` (11 px): the spec forbids setting an ink
    // below 12 px because lime clears AA on its own tint by only 0.10, and this
    // pill is painted in whichever ink the tile carries.
    bandTrailing={
      count ? (
        <span className={`text-caption font-semibold tabular-nums ${FEATURE_INK_TEXT[feature]}`}>
          {count}
        </span>
      ) : undefined
    }
  >
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-heading text-lantern-text">{title}</p>
        <p className="text-caption text-lantern-text-secondary mt-0.5">{promise}</p>
      </div>
      <ChevronRightIcon
        className={`w-5 h-5 shrink-0 mt-0.5 ${FEATURE_INK_TEXT[feature]}`}
        aria-hidden="true"
      />
    </div>
  </Card>
);

export default DoorTile;
