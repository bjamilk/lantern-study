import {
  COVER_MIGRATION_NAME,
  COVER_SERVER_UPDATE_MESSAGE,
  coverMenuItems,
  coverRequestPath,
  coverTileBox,
  coverTileSource,
  describeCoverFailure,
  validateCoverAsset,
} from './coverPickerModel';

describe('coverMenuItems', () => {
  it('offers only the two ways IN when there is no cover', () => {
    const items = coverMenuItems({ hasCover: false });
    expect(items.map((i) => i.action)).toEqual(['library', 'camera']);
  });

  it('offers Remove last, and only once a cover exists', () => {
    const items = coverMenuItems({ hasCover: true });
    expect(items.map((i) => i.action)).toEqual(['library', 'camera', 'remove']);
    expect(items[2].label).toBe('Remove cover');
    expect(items[2].destructive).toBe(true);
  });

  it('never offers a Generate row — this app has no image generation', () => {
    const labels = [
      ...coverMenuItems({ hasCover: false }),
      ...coverMenuItems({ hasCover: true }),
    ].map((i) => i.label.toLowerCase());
    expect(labels.some((l) => l.includes('generate'))).toBe(false);
  });

  it('says that choosing again replaces, rather than adds', () => {
    expect(coverMenuItems({ hasCover: true })[0].hint).toMatch(/replace/i);
    expect(coverMenuItems({ hasCover: false })[0].hint).toBeUndefined();
  });
});

describe('validateCoverAsset', () => {
  it('accepts the four types the server accepts', () => {
    for (const mimeType of ['image/jpeg', 'image/png', 'image/webp', 'image/gif']) {
      expect(validateCoverAsset({ mimeType, fileSize: 1000 })).toBeNull();
    }
  });

  it('refuses a non-image outright', () => {
    expect(validateCoverAsset({ mimeType: 'application/pdf' })).toBe('Pick an image.');
  });

  it('refuses an image type the cover route would reject', () => {
    expect(validateCoverAsset({ mimeType: 'image/heic' })).toMatch(/JPEG, PNG, WebP or GIF/);
  });

  it('refuses over 10 MB locally, so the refusal costs no round trip', () => {
    expect(validateCoverAsset({ mimeType: 'image/jpeg', fileSize: 11 * 1024 * 1024 })).toMatch(
      /over 10 MB/
    );
    expect(validateCoverAsset({ mimeType: 'image/jpeg', fileSize: 10 * 1024 * 1024 })).toBeNull();
  });

  it('passes an asset the picker described with nothing', () => {
    expect(validateCoverAsset({})).toBeNull();
  });
});

describe('coverTileSource', () => {
  it('draws the pastel glyph when the row has no cover', () => {
    expect(coverTileSource({})).toEqual({ kind: 'glyph' });
  });

  it('draws the cover once a signed URL has resolved', () => {
    expect(coverTileSource({ resolvedUri: 'https://x/thumb.jpg' })).toEqual({
      kind: 'cover',
      uri: 'https://x/thumb.jpg',
    });
  });

  it('shows the just-picked file before the upload finishes', () => {
    expect(
      coverTileSource({ pendingUri: 'file:///tmp/pick.jpg', resolvedUri: 'https://x/old.jpg' })
    ).toEqual({ kind: 'cover', uri: 'file:///tmp/pick.jpg' });
  });

  it('stays a glyph while a path is still being signed, so the list does not reflow', () => {
    expect(coverTileSource({ resolvedUri: null })).toEqual({ kind: 'glyph' });
  });
});

describe('coverTileBox', () => {
  it('keeps the row height and buys width with 4:3', () => {
    expect(coverTileBox(40, 0.3)).toEqual({ width: 53, height: 40, radius: 12 });
  });
});

describe('describeCoverFailure', () => {
  it('turns a 503 into one sentence plus the migration in the small print', () => {
    const failure = describeCoverFailure(
      Object.assign(new Error('Covers are not enabled yet'), { status: 503 })
    );
    expect(failure.message).toBe(COVER_SERVER_UPDATE_MESSAGE);
    expect(failure.detail).toBe(`Waiting on ${COVER_MIGRATION_NAME}`);
  });

  it('prefers the migration the server itself named', () => {
    const failure = describeCoverFailure(
      Object.assign(new Error('Missing 20261001090000_other.sql'), { status: 503 })
    );
    expect(failure.detail).toBe('Waiting on 20261001090000_other.sql');
  });

  it('never prints a bare class name as the reason', () => {
    const failure = describeCoverFailure(Object.assign(new Error('Error'), { status: 500 }));
    expect(failure.message).toBe('Could not update the cover (server said 500).');
  });

  it('says something even when the failure carried no words at all', () => {
    expect(describeCoverFailure(null).message).toMatch(/Check your connection/);
  });

  it('passes a real server sentence through unchanged', () => {
    expect(describeCoverFailure(new Error('That deck is not yours.')).message).toBe(
      'That deck is not yours.'
    );
  });
});

/**
 * The exact routes, because `/notes//cover` shipped.
 *
 * These strings are `apps/api-server/src/routes/{decks,notes,studySets}.ts`
 * read back: `/:deckId/cover`, `/:noteId/cover`, and the study set's
 * `/users/me/study-sets/:setId/cover`.
 */
describe('coverRequestPath', () => {
  it('builds the route for each kind', () => {
    expect(coverRequestPath({ kind: 'deck', id: 'deck-1' })).toBe('/decks/deck-1/cover');
    expect(coverRequestPath({ kind: 'note', id: 'note-7' })).toBe('/notes/note-7/cover');
    expect(coverRequestPath({ kind: 'study-set', id: 'set-3' })).toBe(
      '/users/me/study-sets/set-3/cover'
    );
  });

  it('encodes a study set id the way the client does', () => {
    expect(coverRequestPath({ kind: 'study-set', id: 'a b/c' })).toBe(
      '/users/me/study-sets/a%20b%2Fc/cover'
    );
  });

  it.each(['deck', 'note', 'study-set'] as const)('throws on an empty %s id', (kind) => {
    expect(() => coverRequestPath({ kind, id: '' })).toThrow(/no .* id/i);
    expect(() => coverRequestPath({ kind, id: '  ' })).toThrow(/no .* id/i);
  });

  it('never builds a path with a double slash', () => {
    expect(() => coverRequestPath({ kind: 'note', id: '' })).toThrow();
    expect(coverRequestPath({ kind: 'note', id: 'n1' })).not.toContain('//');
  });
});
