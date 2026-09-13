import {
  SET_TILE_UNSUPPORTED_MESSAGE,
  changedSetTilePick,
  isSetTileUnsupportedMessage,
  setTileSaveDropped,
} from '@lantern/shared/study/setTileSave';
import { SET_TILE_GLYPHS } from './setPresentation';
import { TILE_ICONS } from './setTileIcons';

/**
 * What `StudySetSettingsScreen.save()` decides, and what `SetTileArt` can draw.
 *
 * The screen itself is a React tree this project's node jest does not render,
 * so what is pinned here is the two pure decisions it delegates — did the tile
 * move, and did the save keep it — against the exact sequence the SF4a device
 * pass walked: peach + lightbulb, three saves, three green `Study set updated.`
 * toasts, pick gone on reopen.
 */
describe('the phone save path', () => {
  const SET = { tileHue: null, tileGlyph: null };

  it('treats the device pass sequence as a failure, not a success', () => {
    const asked = changedSetTilePick(SET, { hue: 'peach', glyph: 'lightbulb' });
    expect(asked).toEqual({ hue: 'peach', glyph: 'lightbulb' });
    // What a pre-migration api answers: 200, with the tile keys stripped.
    const answered = { id: 's', title: 'Walk test set' } as never;
    expect(setTileSaveDropped(asked, answered)).toBe(true);
  });

  it('says nothing about the tile when only the name was edited', () => {
    // Save always sends the whole form, so this is the case that would turn
    // the fix into a migration sentence on every save a student ever made.
    expect(changedSetTilePick(SET, { hue: null, glyph: null })).toBeNull();
    expect(setTileSaveDropped(null, { id: 's' } as never)).toBe(false);
  });

  it('lets a real save through once the migration is applied', () => {
    const asked = changedSetTilePick(SET, { hue: 'peach', glyph: 'lightbulb' });
    expect(setTileSaveDropped(asked, { tileHue: 'peach', tileGlyph: 'lightbulb' })).toBe(false);
  });

  it('recognises the server 503 as the same failure as the silent drop', () => {
    // Both paths end at the tile block; a student must not have to tell two
    // failures apart by which corner of the screen they appeared in.
    expect(isSetTileUnsupportedMessage(SET_TILE_UNSUPPORTED_MESSAGE)).toBe(true);
    expect(isSetTileUnsupportedMessage('Could not update this set.')).toBe(false);
  });
});

describe('SetTileArt can draw every glyph Home and the room header may hand it', () => {
  it('maps all six glyph names to a real icon', () => {
    // Home's cards and the room header now derive their glyph rather than
    // drawing one fixed `layers` disc, so any unmapped name is a hole on a
    // surface that used to be incapable of having one.
    for (const glyph of SET_TILE_GLYPHS) {
      expect(TILE_ICONS[glyph]).toBeTruthy();
    }
    expect(Object.keys(TILE_ICONS).sort()).toEqual([...SET_TILE_GLYPHS].sort());
  });
});
