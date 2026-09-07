/**
 * The two colours a spot illustration is drawn in, and the three sizes it may
 * be drawn at.
 *
 * Pure, like `appIconStroke.ts` beside it, so the interesting decisions — the
 * ground inversion, and how big the drawing inside the box is — are
 * unit-testable without a renderer. `Illustration.tsx` is the only consumer
 * and re-exports it.
 *
 * WHAT IS NOT HERE ANY MORE: the per-asset ink boxes and the frame margin.
 * They moved to `@lantern/shared/design`, beside the geometry they crop, so
 * web's inline `<svg>` and this file's `react-native-svg` frame the ten
 * drawings identically instead of one platform cropping and the other not.
 * They are re-exported below because this is where mobile callers look.
 */
import {
  ILLUSTRATION_CONTENT_BOXES,
  ILLUSTRATION_FRAME_MARGIN,
  illustrationViewBox,
  type IllustrationContentBox,
  type IllustrationName,
} from '@lantern/shared/design';

export {
  ILLUSTRATION_CONTENT_BOXES,
  ILLUSTRATION_FRAME_MARGIN,
  illustrationViewBox,
  type IllustrationContentBox,
};

/**
 * 96 = the hero on an empty screen, 72 = a card's own picture, 56 = a tile's
 * or a band's. Three and no others, for the same reason `FeatureDisc` has
 * three: a fourth size is a new decision, not a tweak.
 */
export type IllustrationSize = 96 | 72 | 56;

export const ILLUSTRATION_SIZES: IllustrationSize[] = [96, 72, 56];

/**
 * Which colour fills the one filled shape in the asset (the ground ellipse).
 *
 * `tint` — the default: the asset sits on a NEUTRAL surface, so the ground is
 * the feature's tint, exactly as authored.
 *
 * `surface` — the asset sits ON that same tint (an empty state's band, a
 * full-tint coaching card). A tint ground on a tint ground is invisible and
 * the subject would look as though it were floating; the pair inverts, the
 * ink is unchanged, and the geometry is identical either way. This is the
 * same inversion `FeatureDisc`'s `variant` makes, for the same reason.
 */
export type IllustrationVariant = 'tint' | 'surface';

export function illustrationFills({
  ink,
  tint,
  surface,
  variant,
}: {
  ink: string;
  tint: string;
  surface: string;
  variant: IllustrationVariant;
}): { stroke: string; ground: string } {
  return { stroke: ink, ground: variant === 'surface' ? surface : tint };
}

/**
 * The three props the renderer hands its `Svg`, as data.
 *
 * This is the whole of "how big is it": `width` and `height` are the size the
 * call site asked for and nothing else may touch them, and `viewBox` is the
 * asset's own ink box rather than the authored 96-square. Extracted so the
 * rule is testable without a renderer — this project's jest run is node-only,
 * so a rendered-tree assertion is not available and a pure planner is how the
 * other sizing rules here (`appIconStroke`, `illustrationFills`) are pinned.
 */
export function illustrationSvgProps(
  name: IllustrationName,
  size: number
): { width: number; height: number; viewBox: string } {
  return { width: size, height: size, viewBox: illustrationViewBox(name) };
}
