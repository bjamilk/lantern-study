/**
 * How a study SET presents itself in a list, on the phone.
 *
 * THE DERIVATIONS ARE NOT HERE. They live once, in
 * `packages/shared/src/study/setPresentation.ts`, and this file binds the
 * phone's wording to them. It used to be a second, hand-synced copy of all
 * three functions, and the two had already drifted apart in the way that
 * mattered most: the hash here carried an avalanche step the shared one did
 * not, so `setTileArt` gave the same set a DIFFERENT hue on the phone than in
 * the browser — the exact bug the module exists to prevent. The shared copy now
 * carries the stronger hash (see the 200-uuid distribution test there); this
 * file carries only the two places the phone's COPY differs from the web's.
 *
 * The path stays because `StudySetCard`, `StudyHubScreen`,
 * `StudySetSettingsScreen` and `setTileColors` all import from it.
 */

import {
  formatShortDate,
  relativeStudiedLabel as sharedRelativeStudiedLabel,
  setCountChips as sharedSetCountChips,
  type SetCounts,
} from '@lantern/shared/study/setPresentation';

export {
  SET_TILE_GLYPHS,
  SET_TILE_HUES,
  setTileArt,
  type SetCountChip,
  type SetCounts,
  type SetTileGlyph,
  type SetTileHue,
} from '@lantern/shared/study/setPresentation';

/**
 * The phone's chips are sentence case — `4 materials`, not `4 Materials`.
 *
 * The card sets them beside a glyph at caption size, where title case reads as
 * a proper noun. The web card's pills are title case and stay that way; the
 * words, the order and the dropped zeroes are the shared function's.
 */
export function setCountChips(counts: SetCounts) {
  return sharedSetCountChips(counts, { labelCase: 'sentence' });
}

/**
 * The phone's last-studied line, which is allowed to say nothing.
 *
 * `''`, not "Not studied yet": `StudySetCard` renders the whole line only when
 * this is non-empty, and a set made a minute ago has never been studied — so
 * "Last studied Not studied yet" tells a student off for a set they have only
 * just named. The web card wraps the same string in `Last studied · {label}`
 * and does need words there, which is why the wording is a parameter.
 *
 * The phone also drops to an absolute date after a WEEK rather than four, and
 * writes it `2 Sep` rather than through `toLocaleDateString`: the card gives
 * this line one short line of a two-line cell, and `9/2/2026` does not fit.
 */
export function relativeStudiedLabel(iso: string | null | undefined, now?: Date): string {
  return sharedRelativeStudiedLabel(iso, now ?? new Date(), {
    emptyLabel: '',
    absoluteAfterDays: 7,
    formatDate: formatShortDate,
  });
}
