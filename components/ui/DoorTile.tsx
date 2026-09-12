import React from 'react';
import { Illustration, type IllustrationName } from './Illustration';
import {
  FEATURE_INK_TEXT,
  FEATURE_PANEL_INK_OVERRIDE,
  FEATURE_PANEL_INK_TEXT,
  FEATURE_TINT_BG,
  type FeatureKey,
} from './featureClasses';

/** A door's picture, and the one size it gets. Mirrors mobile's `FeatureTile`. */
export const DOOR_ILLUSTRATION_SIZE = 56;
/** The rendered size of the stand-in glyph when a door has no illustration. */
export const DOOR_GLYPH_SIZE = 32;

export interface DoorTileProps {
  feature: FeatureKey;
  /**
   * The footer glyph — the FEATURE's mark, drawn small under the panel in the
   * feature's own ink. Size it at the call site (`w-4 h-4`).
   */
  icon: React.ReactNode;
  /** The door's picture, drawn as a line illustration on the pastel panel. */
  illustration?: IllustrationName;
  title: string;
  /** One line, a promise rather than a description of the screen behind it. */
  promise: string;
  /** Count pill: "12 due", "3 saved". Omitted when there is nothing to count. */
  count?: string;
  onClick: () => void;
  className?: string;
}

/**
 * A door, in the StudyFetch anatomy the 2026-09-11 direction asks for:
 *
 *   white card
 *   ├─ a flat pastel PANEL over the top two thirds, with a black line
 *   │  illustration centred on it
 *   ├─ the title and its one-line promise
 *   └─ a footer row: the feature's glyph in the feature's ink, and the count
 *
 * and the whole card sits on a hard black offset shadow — 4 px, no blur, no
 * alpha, drawn in `--color-ink`.
 *
 * WHAT CHANGED, AND WHY THE OLD TINT-CAP RULE WENT WITH IT. The previous door
 * was a neutral card with a 32 px tint BAND, sized that way to keep the tile
 * under a 25%-tint cap. That cap was the whole reason the picture could not go
 * on the colour: a 56 px band put the tile at 42%. The reference product
 * inverts the ratio deliberately — the panel is the tile's largest element,
 * and it is what makes a wall of doors scannable by hue at arm's length. So
 * the cap is gone and the panel is ~66%.
 *
 * The cap was never a legibility rule: nothing is set ON the panel except a
 * line illustration, and the title, promise and count all sit on the white
 * body below it. `contrast.test.ts` still gates body ink on every tint, and
 * still caps how saturated a tint may be, which is the part that was load
 * bearing. `DoorTile.test.tsx` now asserts this anatomy instead of the ratio.
 *
 * DARK MODE. The panel becomes the feature's dark tint and the line glyph
 * becomes the feature's light ink (`FEATURE_PANEL_INK_TEXT`) — flat black on a
 * near-black panel is the one way this anatomy breaks. The offset shadow is
 * drawn in `--color-ink`, which inverts, so the card keeps an edge.
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
  <button
    type="button"
    onClick={onClick}
    className={`group text-left w-full overflow-hidden rounded-lantern-xl border border-lantern-border bg-lantern-surface shadow-lantern-hard transition-transform duration-150 active:translate-x-px active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/40 ${className}`}
  >
    <div
      data-testid="door-panel"
      className={`flex h-28 items-center justify-center ${FEATURE_TINT_BG[feature]} ${FEATURE_PANEL_INK_TEXT[feature]}`}
    >
      {illustration ? (
        <Illustration
          name={illustration}
          feature={feature}
          size={DOOR_ILLUSTRATION_SIZE}
          className={FEATURE_PANEL_INK_OVERRIDE[feature]}
        />
      ) : (
        // No drawing for this door yet: the feature's own glyph stands in, at
        // the illustration's weight rather than the footer's. The `icon` node
        // is sized for the footer by its call site, so the panel re-sizes the
        // SVG it contains instead of asking every caller to pass it twice.
        <span
          data-testid="door-panel-glyph"
          aria-hidden="true"
          className="flex items-center justify-center [&_svg]:w-8 [&_svg]:h-8"
        >
          {icon}
        </span>
      )}
    </div>
    <div className="p-4 md:p-5">
      <p className="text-heading text-lantern-text">{title}</p>
      <p className="text-caption text-lantern-text-secondary mt-0.5">{promise}</p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span
          data-testid="door-footer-glyph"
          aria-hidden="true"
          className={`flex items-center ${FEATURE_INK_TEXT[feature]}`}
        >
          {icon}
        </span>
        {count ? (
          // `caption` (13 px), not `label` (11 px): this pill is painted in
          // whichever ink the tile carries, and the spec forbids setting an ink
          // below 12 px.
          <span className={`text-caption font-semibold tabular-nums ${FEATURE_INK_TEXT[feature]}`}>
            {count}
          </span>
        ) : null}
      </div>
    </div>
  </button>
);

export default DoorTile;
