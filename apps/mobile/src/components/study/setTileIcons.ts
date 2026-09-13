/**
 * The six tile glyph names, in the app's own icon vocabulary.
 *
 * `setPresentation.ts` names glyphs the way the design direction does
 * (`lightbulb`, `monitor`) because the same six names ship on web, where the
 * icon set is a different one. The translation lives here rather than in the
 * contract. `easel` is this set's nearest thing to a screen; there is no
 * monitor glyph mapped, and adding one to the shared icon map would collide
 * with the lanes editing `components/ui`.
 *
 * A `.ts` beside the card rather than inside it, for the reason every other
 * test in this folder states: this project's mobile jest is plain ts-jest on
 * node, so a map that lives in `StudySetCard.tsx` cannot be checked for
 * completeness without mounting react-native. Home's cards and the room header
 * now derive their glyph instead of drawing one fixed disc, so an unmapped
 * name would be a hole on two surfaces that previously could not have one —
 * which is exactly the thing worth a test.
 */
import type { AppIconName } from '../ui';
import type { SetTileGlyph } from './setPresentation';

export const TILE_ICONS: Record<SetTileGlyph, AppIconName> = {
  layers: 'layers',
  monitor: 'easel',
  lightbulb: 'bulb',
  book: 'book',
  flask: 'flask',
  globe: 'globe',
};
