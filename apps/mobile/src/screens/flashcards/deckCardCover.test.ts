/**
 * What `DeckCard` and `NoteCard` draw in their tile slot.
 *
 * This jest runs on node with no React Native renderer, so the assertion is on
 * the decision the card makes, not on a rendered tree: `readCoverPath` +
 * `coverTileSource` are exactly what the two cards call, with the row shapes
 * those lists actually hold.
 */
import { readCoverPath, coverTileSource, coverTileBox } from '../../components/ui/coverPickerModel';
import type { Deck } from '../../stores';
import type { StudyNote } from '../../services/notes';

const deck = (over: Partial<Deck> = {}): Deck => ({
  id: 'deck-1',
  name: 'Pharmacology',
  card_count: 12,
  due_count: 3,
  ...over,
});

const note = (over: Partial<StudyNote> = {}): StudyNote =>
  ({
    id: 'note-1',
    title: 'Week 3 lecture',
    body: '',
    ...over,
  }) as StudyNote;

describe('DeckCard tile', () => {
  it('without a cover, draws the pastel feature disc', () => {
    const row = deck();
    expect(readCoverPath(row)).toBeNull();
    expect(coverTileSource({ resolvedUri: null })).toEqual({ kind: 'glyph' });
  });

  it('with a cover, draws the picture at 4:3 and the row keeps its height', () => {
    const row = deck({ cover_path: 'cover-images/u1/deck-1.jpg' });
    expect(readCoverPath(row)).toBe('cover-images/u1/deck-1.jpg');
    expect(coverTileSource({ resolvedUri: 'https://signed/thumb' })).toEqual({
      kind: 'cover',
      uri: 'https://signed/thumb',
    });
    // 40 is the FeatureDisc size the picture replaces — same height, more width.
    expect(coverTileBox(40, 0.3).height).toBe(40);
    expect(coverTileBox(40, 0.3).width).toBe(53);
  });

  it('reads a cover the cover route wrote in camelCase onto a snake_case row', () => {
    expect(readCoverPath(deck({ coverPath: 'cover-images/u1/new.jpg', cover_path: null }))).toBe(
      'cover-images/u1/new.jpg'
    );
  });

  it('treats a cleared cover as no cover', () => {
    expect(readCoverPath(deck({ cover_path: null, coverPath: null }))).toBeNull();
  });
});

describe('NoteCard tile', () => {
  it('without a cover, draws the pastel type mark', () => {
    expect(readCoverPath(note())).toBeNull();
    expect(coverTileSource({})).toEqual({ kind: 'glyph' });
  });

  it('with a cover, draws the picture', () => {
    expect(readCoverPath(note({ coverPath: 'cover-images/u1/note-1.png' }))).toBe(
      'cover-images/u1/note-1.png'
    );
    expect(coverTileSource({ resolvedUri: 'https://signed/note-thumb' })).toEqual({
      kind: 'cover',
      uri: 'https://signed/note-thumb',
    });
  });
});
