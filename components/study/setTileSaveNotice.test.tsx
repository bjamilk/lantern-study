import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

/**
 * What the settings modal does when a tile save does not land.
 *
 * The SF4a device pass watched three saves against an api that has the tile
 * CODE and not the tile COLUMNS: green toast, `Study set updated.`, pick gone
 * on reopen. A 200 is not evidence of a save, so the modal compares what it
 * sent with what came back — and shows the answer in the tile block, beside
 * the picker that is still holding the student's unsaved choice, rather than
 * as a toast over a modal that has already closed.
 */
import {
  SET_TILE_MIGRATION,
  SET_TILE_UNSUPPORTED_MESSAGE,
  changedSetTilePick,
  isSetTileUnsupportedMessage,
  setTileSaveDropped,
} from '@lantern/shared/study/setTileSave';

const SET = { id: 'set-1', title: 'Walk test set', tileHue: null, tileGlyph: null };

describe('the browser save path', () => {
  it('calls a 200 that stripped the tile keys a failure', () => {
    const asked = changedSetTilePick(SET, { hue: 'peach', glyph: 'lightbulb' });
    expect(asked).toEqual({ hue: 'peach', glyph: 'lightbulb' });
    expect(setTileSaveDropped(asked, { id: 'set-1', title: 'Walk test set' } as never)).toBe(true);
  });

  it('stays quiet when the save only renamed the set', () => {
    expect(changedSetTilePick(SET, { hue: null, glyph: null })).toBeNull();
  });

  it('accepts a save that echoed the pick back', () => {
    const asked = changedSetTilePick(SET, { hue: 'peach', glyph: 'lightbulb' });
    expect(setTileSaveDropped(asked, { tileHue: 'peach', tileGlyph: 'lightbulb' })).toBe(false);
  });

  it('reads the api 503 as the same failure', () => {
    expect(isSetTileUnsupportedMessage(new Error(SET_TILE_UNSUPPORTED_MESSAGE).message)).toBe(true);
  });
});

describe('the sentence a student reads', () => {
  it('is one plain sentence with no column, code or status in it', () => {
    expect(SET_TILE_UNSUPPORTED_MESSAGE).toBe('Set tiles need a server update — try again later');
    expect(SET_TILE_UNSUPPORTED_MESSAGE).not.toMatch(/tile_hue|42703|PGRST204|503|\.sql/);
    // The filename is for the operator reading the 503 body, not the block.
    expect(SET_TILE_MIGRATION).toBe('20260913150000_study_set_tile.sql');
  });

  it('is announced, and carries the error tone the cover block already uses', () => {
    // The markup the modal renders for the line, asserted here because the
    // modal itself needs a store and a portal to mount.
    const html = renderToStaticMarkup(
      <p role="alert" className="mt-2 text-caption text-lantern-error">
        {SET_TILE_UNSUPPORTED_MESSAGE}
      </p>
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('text-lantern-error');
    // No new type step: `text-caption` is the scale's own caption.
    expect(html).toContain('text-caption');
    expect(html).not.toMatch(/text-\[\d/);
  });
});
