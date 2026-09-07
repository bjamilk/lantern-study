import React from 'react';
import { ChevronRightIcon } from '@heroicons/react/24/outline';
import { Card } from './Card';
import { Illustration, type IllustrationName } from './Illustration';
import { FEATURE_INK_TEXT, type FeatureKey } from './featureClasses';

/** A door's picture, and the one size it gets. Mirrors mobile's `FeatureTile`. */
export const DOOR_ILLUSTRATION_SIZE = 56;

export interface DoorTileProps {
  feature: FeatureKey;
  /** The band glyph — the FEATURE's mark. Size it at the call site (`w-6 h-6`). */
  icon: React.ReactNode;
  /**
   * The door's spot illustration (§5.6: doors and empty states are the only
   * two places one may appear). It is drawn in the BODY, on the chevron's row,
   * never in the band — see the note below. Omitting it draws the door exactly
   * as before.
   */
  illustration?: IllustrationName;
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
 *
 * WHERE THE PICTURE GOES (§5.6 "Imagery rule"), and why not in the band:
 *
 *   1. Tint budget, which is the binding one. The band is 32 px of a ~132 px
 *      tile, i.e. 24% against a 25% cap. Growing it to 56 px to fit a 96-unit
 *      asset puts the door at 56/132 ≈ 42% — over the cap on all nine doors at
 *      once. In the body the picture costs no tint at all: the only filled part
 *      of the asset is its ground ellipse, and the ~64 px of height it adds
 *      takes the tile DOWN to about 19%.
 *   2. The band already carries a mark. The glyph is the FEATURE's mark and the
 *      illustration is the DOOR's picture; stacked in one strip they read as two
 *      competing logos.
 *   3. It is what mobile does (`FeatureTile` in apps/mobile), so one door looks
 *      like the same door on both platforms — from the same asset.
 *
 * The picture is decorative: the title, promise and count already say what the
 * door is, so `Illustration` goes unlabelled and stays out of the a11y tree.
 */
export const DoorTile: React.FC<DoorTileProps> = ({
  feature,
  icon,
  illustration,
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
    <div className="flex flex-col gap-2">
      <div className="min-w-0">
        <p className="text-heading text-lantern-text">{title}</p>
        <p className="text-caption text-lantern-text-secondary mt-0.5">{promise}</p>
      </div>
      <div className="flex items-end justify-between gap-2">
        {illustration ? (
          <Illustration
            name={illustration}
            feature={feature}
            size={DOOR_ILLUSTRATION_SIZE}
          />
        ) : (
          <span />
        )}
        <ChevronRightIcon
          className={`w-5 h-5 shrink-0 ${FEATURE_INK_TEXT[feature]}`}
          aria-hidden="true"
        />
      </div>
    </div>
  </Card>
);

export default DoorTile;
