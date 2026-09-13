import React from 'react';
import {
  setTileArt,
  type SetTileGlyph,
  type SetTileHue,
} from '@lantern/shared/study/setPresentation';
import { AppIcon, type AppIconName } from '../ui/AppIcon';
import { FEATURE_TINT_BG, type FeatureKey } from '../ui/featureClasses';

/**
 * A study set's identity tile: a rounded pastel square with the set's own
 * glyph, drawn beside its name wherever the set appears AS AN OBJECT — the room
 * header, the switcher pill, every row of the switcher list.
 *
 * The art comes from `setTileArt`, the same derivation `StudySetCard` draws the
 * set list with and the same one the phone uses, so one set is the same colour
 * and the same glyph everywhere it appears. That is the whole point of an
 * identity tile: a set that is peach in the list and lilac in its own header is
 * two objects to the student.
 *
 * The old room header had no tile at all — a set read as a page title rather
 * than as something you own.
 */

/** The reference's six pastels, against this palette's feature tints. */
const HUE_FEATURE: Record<SetTileHue, FeatureKey> = {
  mint: 'sets',
  peach: 'budget',
  lilac: 'ai',
  lime: 'flashcards',
  sky: 'tests',
  butter: 'recording',
};

const GLYPH_ICON: Record<SetTileGlyph, AppIconName> = {
  layers: 'layers',
  monitor: 'easel',
  lightbulb: 'bulb',
  book: 'book',
  flask: 'flask',
  globe: 'globe',
};

interface SetTileProps {
  /** The set's id — what the art is keyed on, so it survives a rename. */
  setId: string;
  /** Its name, which is what a subject cue ("Organic Chemistry") is read from. */
  title: string;
  /** Rendered edge length in px. The glyph and the radius are sized off it. */
  size?: number;
  className?: string;
}

export const SetTile: React.FC<SetTileProps> = ({ setId, title, size = 40, className = '' }) => {
  const art = setTileArt(setId, title);
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3) }}
      className={`inline-flex shrink-0 items-center justify-center text-lantern-ink ${
        FEATURE_TINT_BG[HUE_FEATURE[art.hue]]
      } ${className}`}
    >
      <AppIcon name={GLYPH_ICON[art.glyph]} size={Math.round(size * 0.5)} />
    </span>
  );
};

export default SetTile;
