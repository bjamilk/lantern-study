import {
  SET_TILE_HUES,
  relativeStudiedLabel,
  setCountChips,
  setTileArt,
  formatShortDate,
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

/**
 * The distribution guard lifted from the phone's copy when the two
 * implementations were deduped.
 *
 * This is the test that proves the mobile hash was the stronger one: the web
 * copy's plain FNV-1a passed the 60-id `set-N` check above and still put 200
 * UUID-shaped ids on three hues, because uuids share long prefixes and `% 6`
 * reads only the low bits that FNV-1a leaves structure in.
 */
describe('setTileArt distribution on uuid-shaped ids', () => {
  it('spreads 200 UUIDs over every hue and every glyph', () => {
    const hues = new Set<string>();
    const glyphs = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const art = setTileArt(`9c0f7a${i}-8b2d-4e1f-9a3c-${String(i).padStart(12, '0')}`);
      hues.add(art.hue);
      glyphs.add(art.glyph);
    }
    // The defect this replaces was ONE hue and ONE glyph for every set.
    expect(hues.size).toBe(6);
    expect(glyphs.size).toBe(6);
  });

  it('does not move the art when a set is renamed to another unkeyed title', () => {
    const id = 'aa11bb22-cc33-dd44-ee55-ff6677889900';
    expect(setTileArt(id, 'Midterm review').hue).toBe(setTileArt(id, 'Week 4').hue);
  });

  it('survives an empty id', () => {
    const art = setTileArt('');
    expect(art.hue).toBeTruthy();
    expect(art.glyph).toBeTruthy();
  });

  it('reads a computer-science title as a monitor and not a flask', () => {
    // `science` is a flask cue and `comput` a monitor one; precedence decides.
    expect(setTileArt('x', 'Intro to Computer Science').glyph).toBe('monitor');
    // …and `geometry` is not geography: the globe cue is spelled `geog`, so a
    // maths set falls through to the hash rather than being drawn as a globe.
    expect(setTileArt('x', 'Geometry').glyph).not.toBe('globe');
  });
});

describe('the options the phone binds', () => {
  it('renders chips in sentence case when asked', () => {
    const chips = setCountChips({ materials: 4, lectures: 1 }, { labelCase: 'sentence' });
    expect(chips.map((c) => c.label)).toEqual(['4 materials', '1 lecture']);
  });

  it('reads notes as materials when materials is not given, and never draws both', () => {
    expect(setCountChips({ notes: 3 })[0]).toEqual({
      kind: 'materials',
      count: 3,
      label: '3 Materials',
    });
    expect(setCountChips({ materials: 5, notes: 3 }).map((c) => c.label)).toEqual(['5 Materials']);
  });

  it('can say nothing at all for a set that was never studied', () => {
    const now = new Date('2026-09-13T12:00:00.000Z');
    expect(relativeStudiedLabel(null, now, { emptyLabel: '' })).toBe('');
    expect(relativeStudiedLabel('not a date', now, { emptyLabel: '' })).toBe('');
  });

  it('drops to a locale-free short date on the phone`s seven-day cutoff', () => {
    const now = new Date('2026-09-13T12:00:00.000Z');
    const opts = { absoluteAfterDays: 7, formatDate: formatShortDate };
    expect(relativeStudiedLabel('2026-09-10T10:00:00.000Z', now, opts)).toBe('3d ago');
    expect(relativeStudiedLabel('2026-09-02T10:00:00.000Z', now, opts)).toBe('2 Sep');
  });
});
