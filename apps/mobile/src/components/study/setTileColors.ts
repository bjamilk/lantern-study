/**
 * The six set-tile pastels, as colours.
 *
 * Split from `setPresentation.ts` on purpose: that file is the contract the
 * web lane ships the same copy of and a later lane dedups into
 * `packages/shared`, so it stays pure naming with no palette in it. This file
 * is the RN-side mapping from a hue NAME to the two hexes a tile actually
 * paints with, and it is a `.ts` (not a `.tsx`) so the contrast test below can
 * import it under this project's node jest.
 *
 * Light values are StudyFetch's own measured pastels, the same ones
 * `featureAccentsLight` already carries for the four hues the feature palette
 * happens to share (cyan #bbeef0, lime #bcf887, violet #f5d5ff, yellow
 * #f9f284). Mint and peach have no feature-palette equivalent, so they are
 * taken straight off the product.
 *
 * Dark follows the theme's own inversion rule (tokens.ts): keep the HUE, swap
 * the roles — a near-black of that hue becomes the ground and the pastel
 * becomes the glyph. A tile is not allowed to be a slab of light pastel on a
 * dark page; that is the one thing that makes a dark screen glare.
 *
 * Every `ink` clears 4.5:1 on its own `tint`, which `setTileColors.test.ts`
 * asserts with the same `contrastRatio` the design gate uses.
 */
import type { SetTileHue } from './setPresentation';

export interface SetTileSkin {
  /** The tile's ground. */
  tint: string;
  /** The glyph drawn on it, and any text that sits on the tile. */
  ink: string;
}

export const setTileSkinsLight: Record<SetTileHue, SetTileSkin> = {
  mint: { tint: '#caf2f3', ink: '#0b5a61' },
  peach: { tint: '#ffd6b0', ink: '#8a4310' },
  lilac: { tint: '#f5d5ff', ink: '#7b2cab' },
  lime: { tint: '#bcf887', ink: '#3f6212' },
  sky: { tint: '#bbeef0', ink: '#0b5a61' },
  butter: { tint: '#f9f284', ink: '#5c5200' },
};

export const setTileSkinsDark: Record<SetTileHue, SetTileSkin> = {
  mint: { tint: '#0c2a2e', ink: '#8ae6ec' },
  peach: { tint: '#35210f', ink: '#ffc79a' },
  lilac: { tint: '#2f1b3d', ink: '#e9b8ff' },
  lime: { tint: '#1c2e0e', ink: '#b8f07a' },
  sky: { tint: '#0c2a2e', ink: '#8ae6ec' },
  butter: { tint: '#3a3408', ink: '#f7ee7a' },
};

export function setTileSkin(hue: SetTileHue, isDark: boolean): SetTileSkin {
  return (isDark ? setTileSkinsDark : setTileSkinsLight)[hue];
}
