import {
  SET_TILE_MIGRATION,
  SET_TILE_UNSUPPORTED_MESSAGE,
  changedSetTilePick,
  isSetTileUnsupportedMessage,
  setTileSaveDropped,
} from './setTileSave';

/**
 * The device pass's exact sequence is the first test here: peach + lightbulb
 * against a production api that has the tile code and not the tile columns,
 * which answered 200 and threw the pick away. Anything that makes that case
 * report "saved" again is the defect, not a style change.
 */
describe('setTileSaveDropped', () => {
  it('reports a drop when the returned row has no tile keys at all', () => {
    expect(
      setTileSaveDropped(
        { hue: 'peach', glyph: 'lightbulb' },
        { id: 'set-1', title: 'Walk test set' } as never
      )
    ).toBe(true);
  });

  it('reports a drop when the row carries the keys with the old values', () => {
    expect(
      setTileSaveDropped(
        { hue: 'peach', glyph: 'lightbulb' },
        { tileHue: null, tileGlyph: 'book' }
      )
    ).toBe(true);
  });

  it('is quiet when the pick came back exactly as it was sent', () => {
    expect(
      setTileSaveDropped({ hue: 'peach', glyph: 'lightbulb' }, { tileHue: 'peach', tileGlyph: 'lightbulb' })
    ).toBe(false);
  });

  it('is quiet when half a pick was sent and that half came back', () => {
    expect(setTileSaveDropped({ hue: 'peach' }, { tileHue: 'peach', tileGlyph: null })).toBe(false);
  });

  it('treats a reset as asked-for: null must come back as a present null', () => {
    expect(setTileSaveDropped({ hue: null, glyph: null }, { tileHue: null, tileGlyph: null })).toBe(false);
    // An api that strips the keys cannot prove the reset landed either.
    expect(setTileSaveDropped({ hue: null, glyph: null }, {} as never)).toBe(true);
  });

  it('says nothing when no tile half was asked for', () => {
    // A rename on a pre-migration api must not report a tile the student
    // never touched — every Save sends the whole form.
    expect(setTileSaveDropped(null, {} as never)).toBe(false);
    expect(setTileSaveDropped({}, {} as never)).toBe(false);
  });

  it('says nothing when the save returned nothing to compare against', () => {
    expect(setTileSaveDropped({ hue: 'peach' }, null)).toBe(false);
  });
});

describe('changedSetTilePick', () => {
  it('is null when the form re-sends the set the row already holds', () => {
    expect(changedSetTilePick({ tileHue: 'peach', tileGlyph: 'book' }, { hue: 'peach', glyph: 'book' })).toBeNull();
  });

  it('carries only the half that moved', () => {
    expect(changedSetTilePick({ tileHue: 'peach', tileGlyph: 'book' }, { hue: 'peach', glyph: 'lightbulb' })).toEqual({
      glyph: 'lightbulb',
    });
  });

  it('counts a first pick on a row with no tile fields as a change', () => {
    expect(changedSetTilePick({}, { hue: 'peach', glyph: 'lightbulb' })).toEqual({
      hue: 'peach',
      glyph: 'lightbulb',
    });
  });

  it('counts a reset as a change when the row holds a pick', () => {
    expect(changedSetTilePick({ tileHue: 'peach', tileGlyph: 'book' }, { hue: null, glyph: null })).toEqual({
      hue: null,
      glyph: null,
    });
  });
});

describe('the sentence', () => {
  it('names neither a column nor a status code', () => {
    expect(SET_TILE_UNSUPPORTED_MESSAGE).toBe('Set tiles need a server update — try again later');
    expect(SET_TILE_UNSUPPORTED_MESSAGE).not.toMatch(/tile_hue|42703|PGRST204|503/);
  });

  it('is recognised whichever way a client received it', () => {
    expect(isSetTileUnsupportedMessage(SET_TILE_UNSUPPORTED_MESSAGE)).toBe(true);
    expect(isSetTileUnsupportedMessage('Could not update this set.')).toBe(false);
    expect(isSetTileUnsupportedMessage(undefined)).toBe(false);
  });

  it('points at the migration an operator has to apply', () => {
    expect(SET_TILE_MIGRATION).toBe('20260913150000_study_set_tile.sql');
  });
});
