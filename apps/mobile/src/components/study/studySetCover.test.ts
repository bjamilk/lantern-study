/**
 * What a study set draws in its tile slot, and what its picker is allowed to
 * offer.
 *
 * This jest runs on node with no React Native renderer (`deckCardCover.test.ts`
 * hit the same wall), so the render assertion is on the DECISION the card
 * makes — `coverTileSource`, which is exactly what `SetCoverSquare` calls —
 * rather than on a rendered tree.
 *
 * The rest is the contract the set's own block adds on top of the deck/note
 * cover work:
 *
 *  - it PROMISES 5 MB ("Recommended: 400x400px, max 5MB") and the server
 *    enforces 5 MB, so the local gate must refuse at 5 MB too. A client still
 *    using the deck's 10 MB would push a 7 MB photo over a campus connection
 *    only to be refused on arrival;
 *  - it offers NO camera row. StudyFetch's block is one button into the system
 *    photo picker, and a "Take photo" row is this app inventing a flow the
 *    reference does not have.
 */
import {
  MAX_COVER_BYTES,
  MAX_STUDY_SET_COVER_BYTES,
  STUDY_SET_COVER_HINT,
  coverMenuItems,
  coverTileSource,
  validateCoverAsset,
} from '../ui/coverPickerModel';

describe('study set cover ceiling', () => {
  it('promises 5 MB and refuses at 5 MB', () => {
    expect(MAX_STUDY_SET_COVER_BYTES).toBe(5 * 1024 * 1024);
    expect(STUDY_SET_COVER_HINT).toBe('Recommended: 400x400px, max 5MB');

    const sevenMb = { fileSize: 7 * 1024 * 1024, mimeType: 'image/jpeg' };
    expect(validateCoverAsset(sevenMb, MAX_STUDY_SET_COVER_BYTES)).toContain('5 MB');
    // The same pick under the deck ceiling is fine — that is the difference.
    expect(validateCoverAsset(sevenMb, MAX_COVER_BYTES)).toBeNull();
  });

  it('accepts a pick inside the set ceiling', () => {
    expect(
      validateCoverAsset(
        { fileSize: 4 * 1024 * 1024, mimeType: 'image/png' },
        MAX_STUDY_SET_COVER_BYTES
      )
    ).toBeNull();
  });

  it('still refuses a type the server would refuse', () => {
    expect(
      validateCoverAsset({ mimeType: 'image/svg+xml' }, MAX_STUDY_SET_COVER_BYTES)
    ).toContain('JPEG');
  });
});

describe('study set picker rows', () => {
  it('offers no camera row for a set, and still offers one for a deck', () => {
    expect(coverMenuItems({ hasCover: false, allowCamera: false }).map((r) => r.action)).toEqual([
      'library',
    ]);
    expect(coverMenuItems({ hasCover: false }).map((r) => r.action)).toEqual([
      'library',
      'camera',
    ]);
  });

  it('offers Remove only once there is a cover to remove', () => {
    expect(coverMenuItems({ hasCover: true, allowCamera: false }).map((r) => r.action)).toEqual([
      'library',
      'remove',
    ]);
  });
});

describe('set tile slot', () => {
  it('without a cover, draws the pastel set art', () => {
    expect(coverTileSource({ resolvedUri: undefined })).toEqual({ kind: 'glyph' });
  });

  it('with a signed cover, draws the picture instead of the art', () => {
    expect(
      coverTileSource({ resolvedUri: 'https://signed.example/u1/study-sets/s1/c.webp' })
    ).toEqual({ kind: 'cover', uri: 'https://signed.example/u1/study-sets/s1/c.webp' });
  });

  it('with a path that has not been signed yet, keeps the art', () => {
    // Not a cover yet. Drawing an empty box here is what made a list ripple
    // one row at a time as the signature batcher answered.
    expect(coverTileSource({ pendingUri: null, resolvedUri: null })).toEqual({ kind: 'glyph' });
  });

  it('shows the just-picked photo before the upload finishes', () => {
    expect(
      coverTileSource({ pendingUri: 'file:///tmp/pick.jpg', resolvedUri: 'https://signed/old' })
    ).toEqual({ kind: 'cover', uri: 'file:///tmp/pick.jpg' });
  });
});
