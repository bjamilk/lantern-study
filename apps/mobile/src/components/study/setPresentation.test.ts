import {
  relativeStudiedLabel,
  setCountChips,
  setTileArt,
  type SetTileGlyph,
  type SetTileHue,
} from './setPresentation';
import { setTileSkin, setTileSkinsDark, setTileSkinsLight } from './setTileColors';
import { contrastRatio } from '@lantern/shared/design';

describe('setTileArt', () => {
  it('is stable for an id across calls', () => {
    const a = setTileArt('3f2b0c4e-1111-4222-8333-444455556666');
    const b = setTileArt('3f2b0c4e-1111-4222-8333-444455556666');
    expect(a).toEqual(b);
  });

  it('does not change when the set is renamed to another unkeyed title', () => {
    const id = 'aa11bb22-cc33-dd44-ee55-ff6677889900';
    expect(setTileArt(id, 'Midterm review').hue).toBe(setTileArt(id, 'Week 4').hue);
  });

  it('spreads UUID-shaped ids over every hue and glyph', () => {
    const hues = new Set<SetTileHue>();
    const glyphs = new Set<SetTileGlyph>();
    for (let i = 0; i < 200; i += 1) {
      const art = setTileArt(`9c0f7a${i}-8b2d-4e1f-9a3c-${String(i).padStart(12, '0')}`);
      hues.add(art.hue);
      glyphs.add(art.glyph);
    }
    // The defect this replaces was ONE hue and ONE glyph for every set.
    expect(hues.size).toBe(6);
    expect(glyphs.size).toBe(6);
  });

  it('lets title keywords pick the glyph', () => {
    expect(setTileArt('x1', 'Organic Chemistry').glyph).toBe('flask');
    expect(setTileArt('x1', 'World History').glyph).toBe('globe');
    expect(setTileArt('x1', 'Intro to Programming').glyph).toBe('monitor');
    expect(setTileArt('x1', 'English Literature').glyph).toBe('book');
    expect(setTileArt('x1', 'Music Theory').glyph).toBe('lightbulb');
  });

  it('survives an empty id', () => {
    const art = setTileArt('');
    expect(art.hue).toBeTruthy();
    expect(art.glyph).toBeTruthy();
  });
});

describe('setCountChips', () => {
  it('omits zeros and keeps the reading order', () => {
    const chips = setCountChips({ materials: 4, lectures: 2, decks: 2, tests: 0, quizzes: 3 });
    expect(chips.map((c) => c.kind)).toEqual(['materials', 'lectures', 'decks', 'quizzes']);
    expect(chips.map((c) => c.label)).toEqual(['4 materials', '2 lectures', '2 decks', '3 quizzes']);
  });

  it('singularises', () => {
    const chips = setCountChips({ materials: 1, lectures: 1, decks: 1, tests: 1, quizzes: 1 });
    expect(chips.map((c) => c.label)).toEqual([
      '1 material',
      '1 lecture',
      '1 deck',
      '1 test',
      '1 quiz',
    ]);
  });

  it('reads notes as materials when materials is not given', () => {
    expect(setCountChips({ notes: 3 })[0]).toEqual({
      kind: 'materials',
      count: 3,
      label: '3 materials',
    });
    // …and never draws both.
    expect(setCountChips({ materials: 5, notes: 3 }).map((c) => c.label)).toEqual(['5 materials']);
  });

  it('is empty for an empty set', () => {
    expect(setCountChips({})).toEqual([]);
    expect(setCountChips({ materials: 0, decks: 0 })).toEqual([]);
  });

  it('ignores junk counts rather than printing NaN', () => {
    expect(setCountChips({ materials: Number.NaN, decks: -2 })).toEqual([]);
  });
});

describe('relativeStudiedLabel', () => {
  const now = new Date('2026-09-13T12:00:00.000Z');

  it('reads the scale', () => {
    expect(relativeStudiedLabel('2026-09-13T11:59:40.000Z', now)).toBe('Just now');
    expect(relativeStudiedLabel('2026-09-13T11:37:00.000Z', now)).toBe('23m ago');
    expect(relativeStudiedLabel('2026-09-13T10:00:00.000Z', now)).toBe('2h ago');
    expect(relativeStudiedLabel('2026-09-12T10:00:00.000Z', now)).toBe('Yesterday');
    expect(relativeStudiedLabel('2026-09-10T10:00:00.000Z', now)).toBe('3d ago');
  });

  it('falls back to a date past a week', () => {
    expect(relativeStudiedLabel('2026-09-02T10:00:00.000Z', now)).toBe('2 Sep');
  });

  it('says nothing at all when the set has never been studied', () => {
    expect(relativeStudiedLabel(null, now)).toBe('');
    expect(relativeStudiedLabel(undefined, now)).toBe('');
    expect(relativeStudiedLabel('not a date', now)).toBe('');
  });

  it('does not print a negative age for a clock that is behind', () => {
    expect(relativeStudiedLabel('2026-09-13T12:05:00.000Z', now)).toBe('Just now');
  });
});

describe('set tile colours', () => {
  it('carries a legible glyph in both themes', () => {
    for (const hue of Object.keys(setTileSkinsLight) as SetTileHue[]) {
      expect(contrastRatio(setTileSkinsLight[hue].ink, setTileSkinsLight[hue].tint)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(setTileSkinsDark[hue].ink, setTileSkinsDark[hue].tint)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the light pastel off a dark page — the ground darkens, the glyph lightens', () => {
    for (const hue of Object.keys(setTileSkinsLight) as SetTileHue[]) {
      // The dark ground must be darker than the light one; a pastel slab is
      // the one thing that makes a dark screen glare.
      expect(contrastRatio(setTileSkinsDark[hue].tint, '#000000')).toBeLessThan(
        contrastRatio(setTileSkinsLight[hue].tint, '#000000')
      );
    }
  });

  it('resolves by theme', () => {
    expect(setTileSkin('mint', false)).toEqual(setTileSkinsLight.mint);
    expect(setTileSkin('mint', true)).toEqual(setTileSkinsDark.mint);
  });
});
