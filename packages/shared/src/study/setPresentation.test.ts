import {
  SET_TILE_HUES,
  relativeStudiedLabel,
  setCountChips,
  setTileArt,
} from './setPresentation';

describe('setTileArt', () => {
  it('is stable for the same set id', () => {
    const a = setTileArt('8f1b0c2e-1111-4a2b-9c3d-000000000001', 'Cell Biology');
    const b = setTileArt('8f1b0c2e-1111-4a2b-9c3d-000000000001', 'Cell Biology');
    expect(a).toEqual(b);
  });

  it('spreads across the six hues rather than painting everything mint', () => {
    const hues = new Set(
      Array.from({ length: 60 }, (_, i) => setTileArt(`set-${i}`).hue)
    );
    expect(hues.size).toBe(SET_TILE_HUES.length);
  });

  it('reads the subject out of the title when it can', () => {
    expect(setTileArt('a', 'Organic Chemistry').glyph).toBe('flask');
    expect(setTileArt('b', 'World History 101').glyph).toBe('globe');
    expect(setTileArt('c', 'Intro to Computer Science').glyph).toBe('monitor');
    expect(setTileArt('d', 'English Literature').glyph).toBe('book');
    expect(setTileArt('e', 'Cognitive Psychology').glyph).toBe('lightbulb');
  });

  it('still varies the glyph when the title says nothing', () => {
    const glyphs = new Set(
      Array.from({ length: 60 }, (_, i) => setTileArt(`plain-${i}`, 'Untitled set').glyph)
    );
    expect(glyphs.size).toBeGreaterThan(1);
  });
});

describe('setCountChips', () => {
  it('drops zeroes and keeps the fixed order', () => {
    const chips = setCountChips({ materials: 8, notes: 0, lectures: 6, decks: 3, tests: 2 });
    expect(chips.map((chip) => chip.kind)).toEqual(['materials', 'lectures', 'decks', 'tests']);
    expect(chips[0].label).toBe('8 Materials');
  });

  it('singularises', () => {
    expect(setCountChips({ materials: 1, quizzes: 1 }).map((c) => c.label)).toEqual([
      '1 Material',
      '1 Quiz',
    ]);
  });

  it('returns nothing for an empty set', () => {
    expect(setCountChips({})).toEqual([]);
    expect(setCountChips({ materials: 0, decks: 0 })).toEqual([]);
  });

  it('ignores nonsense counts instead of printing NaN', () => {
    expect(setCountChips({ materials: Number.NaN, decks: -4 })).toEqual([]);
  });
});

describe('relativeStudiedLabel', () => {
  const now = new Date('2026-09-13T12:00:00.000Z');
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it('names the never-studied case honestly', () => {
    expect(relativeStudiedLabel(null, now)).toBe('Not studied yet');
    expect(relativeStudiedLabel(undefined, now)).toBe('Not studied yet');
    expect(relativeStudiedLabel('not-a-date', now)).toBe('Not studied yet');
  });

  it('walks the units', () => {
    expect(relativeStudiedLabel(ago(30_000), now)).toBe('Just now');
    expect(relativeStudiedLabel(ago(23 * 60_000), now)).toBe('23m ago');
    expect(relativeStudiedLabel(ago(5 * 3_600_000), now)).toBe('5h ago');
    expect(relativeStudiedLabel(ago(30 * 3_600_000), now)).toBe('Yesterday');
    expect(relativeStudiedLabel(ago(4 * 86_400_000), now)).toBe('4d ago');
    expect(relativeStudiedLabel(ago(20 * 86_400_000), now)).toBe('2w ago');
  });

  it('falls back to a date once relative stops meaning anything', () => {
    expect(relativeStudiedLabel(ago(200 * 86_400_000), now)).toMatch(/\d/);
    expect(relativeStudiedLabel(ago(200 * 86_400_000), now)).not.toMatch(/ago/);
  });

  it('does not print a future for a skewed clock', () => {
    expect(relativeStudiedLabel(new Date(now.getTime() + 60_000).toISOString(), now)).toBe(
      'Just now'
    );
  });
});
