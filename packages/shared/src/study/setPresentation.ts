/**
 * Study-set card presentation — the three derivations a set tile needs.
 *
 * A set list is the screen a returning student lands on, and until this module
 * every card in it looked identical: one mint disc, the same stacked-layers
 * glyph, `2 decks`, and an absolute date. A set with four notes, two lectures
 * and a deck was indistinguishable from an empty one.
 *
 * The three functions here are pure and platform-free on purpose: web renders
 * them with Tailwind feature tokens, mobile with its own palette, and both must
 * agree on WHICH hue and glyph a given set gets — a set that is peach on the
 * phone and lilac in the browser is a different object to the student.
 */

export type SetTileHue = 'mint' | 'peach' | 'lilac' | 'lime' | 'sky' | 'butter';

export type SetTileGlyph = 'layers' | 'monitor' | 'lightbulb' | 'book' | 'flask' | 'globe';

export const SET_TILE_HUES: readonly SetTileHue[] = [
  'mint',
  'peach',
  'lilac',
  'lime',
  'sky',
  'butter',
];

export const SET_TILE_GLYPHS: readonly SetTileGlyph[] = [
  'layers',
  'monitor',
  'lightbulb',
  'book',
  'flask',
  'globe',
];

/**
 * Subject cues, most specific first. A title that names its subject should get
 * the glyph for it rather than a hash draw — `Organic Chemistry` reading as a
 * flask is worth more than perfect distribution across six glyphs.
 */
const GLYPH_CUES: ReadonlyArray<{ glyph: SetTileGlyph; words: readonly string[] }> = [
  // Order is precedence, not preference: `Computer Science` must draw a monitor
  // and not a flask, and `Medieval History` a globe and not a flask, so the
  // narrower subject wins over the broader one.
  {
    glyph: 'monitor',
    words: ['comput', 'software', 'program', 'code', 'data', 'digital', 'cs ', 'engineer', 'tech'],
  },
  {
    glyph: 'globe',
    words: ['history', 'geog', 'world', 'politic', 'global', 'civic', 'language', 'culture'],
  },
  {
    glyph: 'flask',
    words: ['chem', 'bio', 'lab', 'physic', 'science', 'anatomy', 'pharm', 'nurs', 'med'],
  },
  {
    glyph: 'book',
    words: ['lit', 'english', 'writing', 'essay', 'law', 'philos', 'read', 'poet'],
  },
  {
    glyph: 'lightbulb',
    words: ['psych', 'business', 'econ', 'market', 'design', 'idea', 'theor', 'math', 'stat'],
  },
];

/**
 * A stable 32-bit hash. `setId` is a uuid, so any avalanche-y mix distributes;
 * what matters is that it is the SAME number on both platforms and across
 * sessions, which rules out `Math.random`, insertion order, and array index.
 */
function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The pastel + glyph a set's tile is drawn with. Deterministic per set. */
export function setTileArt(setId: string, title?: string): { hue: SetTileHue; glyph: SetTileGlyph } {
  const seed = hash(setId || title || 'set');
  // `?? ` is unreachable — both tables are non-empty consts and the index is a
  // modulo of their length. It is here because the web app compiles with
  // noUncheckedIndexedAccess, which cannot see that.
  const hue = SET_TILE_HUES[seed % SET_TILE_HUES.length] ?? 'mint';

  const needle = ` ${(title || '').toLowerCase()} `;
  for (const cue of GLYPH_CUES) {
    if (cue.words.some((word) => needle.includes(word))) {
      return { hue, glyph: cue.glyph };
    }
  }
  // No subject cue: spread on a different bit of the same hash so hue and
  // glyph do not move in lockstep (which would give six tile designs, not 36).
  const glyph =
    SET_TILE_GLYPHS[Math.floor(seed / SET_TILE_HUES.length) % SET_TILE_GLYPHS.length] ?? 'layers';
  return { hue, glyph };
}

export interface SetCountChip {
  kind: string;
  count: number;
  /** The full, spoken form — the card shows a glyph + number, screen readers get this. */
  label: string;
}

const CHIP_ORDER: ReadonlyArray<{ kind: string; singular: string; plural: string }> = [
  { kind: 'materials', singular: 'Material', plural: 'Materials' },
  { kind: 'notes', singular: 'Note', plural: 'Notes' },
  { kind: 'lectures', singular: 'Lecture', plural: 'Lectures' },
  { kind: 'decks', singular: 'Deck', plural: 'Decks' },
  { kind: 'tests', singular: 'Test', plural: 'Tests' },
  { kind: 'quizzes', singular: 'Quiz', plural: 'Quizzes' },
];

/**
 * The chip row, in a fixed order, with the zeroes dropped.
 *
 * Zeroes are dropped rather than rendered as `0` because the row's job is "what
 * is in here"; six chips of which four read `0` answers it worse than two that
 * read `4` and `2`. Callers cap the visible count and render the remainder as
 * a `+N` overflow chip.
 */
export function setCountChips(counts: {
  materials?: number;
  notes?: number;
  lectures?: number;
  decks?: number;
  tests?: number;
  quizzes?: number;
}): SetCountChip[] {
  const chips: SetCountChip[] = [];
  for (const entry of CHIP_ORDER) {
    const raw = counts[entry.kind as keyof typeof counts];
    const count = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
    if (count <= 0) continue;
    chips.push({
      kind: entry.kind,
      count,
      label: `${count} ${count === 1 ? entry.singular : entry.plural}`,
    });
  }
  return chips;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * `23m ago` — the relative form, because "how long since I touched this" is the
 * question a set list answers, and `9/13/2026` makes the reader do the
 * subtraction. Beyond four weeks the relative form stops being informative and
 * the absolute date is shown instead.
 */
export function relativeStudiedLabel(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return 'Not studied yet';
  const then = new Date(iso);
  const time = then.getTime();
  if (!Number.isFinite(time)) return 'Not studied yet';

  const delta = now.getTime() - time;
  // A clock skew between device and server must not print "in 3 minutes".
  if (delta < MINUTE) return 'Just now';
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
  if (delta < 2 * DAY) return 'Yesterday';
  if (delta < WEEK) return `${Math.floor(delta / DAY)}d ago`;
  if (delta < 4 * WEEK) return `${Math.floor(delta / WEEK)}w ago`;
  return then.toLocaleDateString();
}
