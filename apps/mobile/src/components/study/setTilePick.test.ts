/**
 * A set's tile on the phone, once its owner has picked one.
 *
 * WHY THIS IS NOT A RENDER TEST. This project's mobile jest is plain ts-jest
 * on node with `testMatch: ['**\/*.test.ts']` — no react-native preset, no
 * .tsx, no renderer. `StudySetCard` pulls in nativewind and react-native and
 * cannot be mounted here, which is why every existing test beside it
 * (`setPresentation`, `setTileColors`, `studySetCover`) asserts the decision
 * the component renders rather than the output. This one does the same, and
 * covers exactly the two lines the card resolves its tile with:
 *
 *     const art = setTileArt(setId, title, { hue: tileHue, glyph: tileGlyph });
 *     const skin = setTileSkin(art.hue, isDark);
 *
 * so a pick that failed to reach the paint would fail here.
 */
import { SET_TILE_GLYPHS, SET_TILE_HUES, setTileArt } from './setPresentation';
import { setTileSkin } from './setTileColors';

const SET_ID = '8f1b0c2e-1111-4a2b-9c3d-000000000001';
const TITLE = 'Cell Biology';

/** What the card would paint with no pick — the thing a pick must beat. */
const derived = setTileArt(SET_ID, TITLE);

describe('the phone card`s tile, with a pick', () => {
  it('paints the picked pastel rather than the hashed one', () => {
    const other = SET_TILE_HUES.find((hue) => hue !== derived.hue)!;
    const art = setTileArt(SET_ID, TITLE, { hue: other, glyph: 'monitor' });
    expect(art).toEqual({ hue: other, glyph: 'monitor' });
    // The tint the card actually sets as the tile's backgroundColor moves with
    // it — a pick that changed only the name would be invisible.
    expect(setTileSkin(art.hue, false).tint).not.toBe(setTileSkin(derived.hue, false).tint);
    expect(setTileSkin(art.hue, true).tint).not.toBe(setTileSkin(derived.hue, true).tint);
  });

  it('keeps a picked glyph against a title that cues another one', () => {
    expect(derived.glyph).toBe('flask');
    expect(setTileArt(SET_ID, TITLE, { glyph: 'book' }).glyph).toBe('book');
  });

  it('overrides the two halves independently', () => {
    const other = SET_TILE_HUES.find((hue) => hue !== derived.hue)!;
    expect(setTileArt(SET_ID, TITLE, { hue: other })).toEqual({ hue: other, glyph: derived.glyph });
    expect(setTileArt(SET_ID, TITLE, { glyph: 'globe' })).toEqual({
      hue: derived.hue,
      glyph: 'globe',
    });
  });

  it('derives again for null — which is what Reset writes — and for junk', () => {
    expect(setTileArt(SET_ID, TITLE, { hue: null, glyph: null })).toEqual(derived);
    expect(setTileArt(SET_ID, TITLE, { hue: 'chartreuse', glyph: 'rocket' })).toEqual(derived);
  });

  it('has a readable skin for every one of the six pastels a student can pick', () => {
    // The settings screen offers all six; a hue with no skin would be a crash
    // on tap. (`TILE_ICONS` is not asserted here: it lives in a .tsx, which
    // this jest cannot resolve, and its `Record<SetTileGlyph, AppIconName>`
    // type already makes an incomplete table a compile error.)
    expect(SET_TILE_GLYPHS).toHaveLength(6);
    for (const hue of SET_TILE_HUES) {
      for (const isDark of [false, true]) {
        const skin = setTileSkin(hue, isDark);
        expect(skin.tint).toMatch(/^#[0-9a-f]{6}$/i);
        expect(skin.ink).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
});
