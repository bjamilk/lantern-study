/**
 * The three tones an icon can be drawn in, and the rule that decides how the
 * "active" one is painted. Spec v3 §5.6 "Icon rule".
 *
 *   neutral  the glyph in the caller's own colour (text colour by default).
 *            Chrome, affordances, anything that is not a feature.
 *   feature  the glyph stroked in a feature's `ink`. Hue = identity, at rest.
 *   active   duotone: `ink` stroke over a `tint` FILL. The current item on a
 *            bar or a segmented control, where the shape itself has to change
 *            so the state does not ride on colour alone.
 *
 * WHY A DENY-LIST
 * A tint fill only reads as duotone when the glyph's outline actually encloses
 * something. lucide draws a handful of icons as a plain container whose whole
 * meaning is the interior detail — `person-circle` is a disc with a face,
 * `checkmark-circle` a disc with a tick — and a fill paints the detail flat.
 * Those fall back to the outline in `ink` sitting on a `tint` DISC, which
 * gives the same two-tone weight without destroying the glyph. Everything else
 * fills: an open sub-path (a tassel line, a window bar) encloses no area, so
 * SVG's implicit close paints nothing at all for it.
 *
 * Pure and import-free — no lucide, no theme — so the rule is unit-tested even
 * though AppIcon itself is a native component this jest environment cannot
 * render. AppIcon.tsx is the only consumer.
 */

export type AppIconTone = 'neutral' | 'feature' | 'active';

/**
 * Glyphs whose interior detail is the glyph. Named as plain strings rather
 * than `AppIconName` so this file stays import-free; `appIconTone.test.ts`
 * asserts every one of them is a real icon name.
 */
export const DUOTONE_BLOB_ICONS: readonly string[] = [
  'person-circle',
  'ellipse',
  'square',
  'radio-button-on',
  'radio-button-off',
  'checkmark-circle',
  'close-circle',
  'help-circle',
  'information-circle',
  'alert-circle',
];

/** How AppIcon should paint one glyph. */
export interface IconTonePaint {
  /** Stroke colour handed to lucide. */
  stroke: string;
  /** Fill colour, or `null` for lucide's default `fill: none`. */
  fill: string | null;
  /** Tint colour for a disc drawn BEHIND the outline, or `null` for no disc. */
  disc: string | null;
}

/**
 * Resolve a tone into the three paints.
 *
 * @param tone Which tone was asked for.
 * @param accent The feature's `{ ink, tint }`; `null` for a neutral icon.
 * @param color The caller's own colour — the only thing `neutral` uses.
 */
export function resolveIconTone(
  tone: AppIconTone,
  accent: { ink: string; tint: string } | null,
  color: string | undefined,
  name: string
): IconTonePaint {
  // A feature tone with no pair is a programming error at a call site; drawing
  // it neutral is better than drawing it invisible.
  if (tone === 'neutral' || !accent) {
    return { stroke: color ?? 'currentColor', fill: null, disc: null };
  }
  if (tone === 'feature') {
    return { stroke: accent.ink, fill: null, disc: null };
  }
  if (isDuotoneBlob(name)) {
    return { stroke: accent.ink, fill: null, disc: accent.tint };
  }
  return { stroke: accent.ink, fill: accent.tint, disc: null };
}

/** True when filling this glyph would paint out the detail that names it. */
export function isDuotoneBlob(name: string): boolean {
  return DUOTONE_BLOB_ICONS.includes(name);
}
