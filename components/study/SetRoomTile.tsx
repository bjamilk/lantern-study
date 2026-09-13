import React from 'react';
import {
  setTileArt,
  type SetTileGlyph,
  type SetTileHue,
} from '@lantern/shared/study/setPresentation';
import { AppIcon, type AppIconName } from '../ui/AppIcon';
import { FEATURE_TINT_BG, type FeatureKey } from '../ui/featureClasses';
import { useResolvedStorageUrl } from '../../hooks/useResolvedStorageUrl';

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

/** Exported so a settings screen's glyph buttons draw the SAME icons the tile does. */
export const GLYPH_ICON: Record<SetTileGlyph, AppIconName> = {
  layers: 'layers',
  monitor: 'easel',
  lightbulb: 'bulb',
  book: 'book',
  flask: 'flask',
  globe: 'globe',
};

/**
 * The set's own picture, in the square the pastel tile occupies.
 *
 * 1:1 and the same radius — StudyFetch's set chip is a square photograph, not
 * a 4:3 thumbnail like a deck row's — and the SAME box, so a set with a cover
 * is exactly as tall as one without and a grid does not reflow as URLs land.
 *
 * With no cover, or a path that cannot be signed, the caller's own tile is
 * what renders: a cover is a decoration on top of an identity that already
 * works, never a replacement for it.
 */
export interface SetCoverSquareProps {
  coverPath?: string | null;
  /** The pastel tile this stands in for. */
  fallback: React.ReactNode;
  size?: number;
  alt?: string;
  className?: string;
}

export const SetCoverSquare: React.FC<SetCoverSquareProps> = ({
  coverPath,
  fallback,
  size = 40,
  alt = '',
  className = '',
}) => {
  // Resolved HERE rather than inside an <img> wrapper so an unsigned path
  // keeps the pastel tile: a path whose signature has not come back yet is not
  // a cover, and drawing an empty box for it is the grey hole a broken
  // signature used to leave on every surface at once.
  const resolved = useResolvedStorageUrl(coverPath, { variant: 'thumb' });
  if (!coverPath || !resolved) return <>{fallback}</>;
  return (
    <span
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3) }}
      className={`inline-flex shrink-0 overflow-hidden bg-lantern-background-secondary ${className}`}
    >
      <img src={resolved} alt={alt} loading="lazy" className="h-full w-full object-cover" />
    </span>
  );
};

interface SetTileProps {
  /** The set's id — what the art is keyed on, so it survives a rename. */
  setId: string;
  /** Its name, which is what a subject cue ("Organic Chemistry") is read from. */
  title: string;
  /**
   * The set's cover, when it has one. It REPLACES the pastel art rather than
   * sitting beside it: the picture is the identity once a student chooses one.
   */
  coverPath?: string | null;
  /**
   * The art its owner picked, when they picked any. Either half may be absent
   * and is then derived. A cover still wins over both.
   */
  tileHue?: string | null;
  tileGlyph?: string | null;
  /** Rendered edge length in px. The glyph and the radius are sized off it. */
  size?: number;
  className?: string;
}

export const SetTile: React.FC<SetTileProps> = ({
  setId,
  title,
  coverPath,
  tileHue,
  tileGlyph,
  size = 40,
  className = '',
}) => {
  const art = setTileArt(setId, title, { hue: tileHue, glyph: tileGlyph });
  if (coverPath) {
    return (
      <SetCoverSquare coverPath={coverPath} size={size} className={className} fallback={null} />
    );
  }
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
