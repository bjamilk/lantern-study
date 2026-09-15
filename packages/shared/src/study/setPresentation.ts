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
 *
 * THIS FILE IS THE ONLY COPY. `apps/mobile/src/components/study/setPresentation.ts`
 * used to carry a second, hand-synced implementation of all three functions;
 * it is now a thin adapter over this one. The two had already drifted — the
 * phone's hash had an avalanche step the browser's lacked, so `setTileArt` gave
 * the same set DIFFERENT hues on the two platforms, which is precisely the bug
 * the module exists to prevent. The phone's stronger hash is the one kept below.
 *
 * WHAT IS SHARED AND WHAT IS A PARAMETER. The derivations — which hue, which
 * glyph, which unit of time — are identical everywhere and take no options. The
 * COPY does not: the web card renders `Last studied · {label}` around this
 * string and so needs a label for the never-studied case, while the phone's
 * card renders the line only `{studiedLabel ? ...}` and needs an empty string so
 * it can draw nothing. One default cannot serve both, so the wording is an
 * option with the web default and mobile binds its own.

 *
 * CONSUMERS: web + mobile set lists and tiles (`apps/mobile/src/components/study/setPresentation.ts` is a thin adapter over this file — do not reintroduce a second implementation). Not the api.
 *
 * GOTCHAS: `packages/shared` is consumed BUILT — run `npm run build` in
 * packages/shared before typechecking or running web/mobile, or consumers
 * resolve a stale `dist/`. A NEW subpath under src/ needs three things: the
 * file, a `packages/shared/package.json` "exports" entry, and an
 * `apps/api-server/tsconfig.json` "paths" entry; mobile jest maps
 * `@lantern/shared/*` subpaths separately, so a subpath imported only by a
 * test produces a CI-only TS2307 (reproduce with `jest --no-cache`). The web
 * turbo build compiles with strict `noUncheckedIndexedAccess`.
 */

/** The six StudyFetch pastels a set tile can take. */
export type SetTileHue = 'mint' | 'peach' | 'lilac' | 'lime' | 'sky' | 'butter';

/** The six glyphs a set tile can carry. */
export type SetTileGlyph = 'layers' | 'book' | 'flask' | 'globe' | 'monitor' | 'lightbulb';

// ---------------------------------------------------------------------------
// Tile art: hue and glyph
// ---------------------------------------------------------------------------
// A set's colour and glyph are DERIVED from its id by hash, not stored, so a
// set looks the same everywhere without a migration. The hash must stay
// byte-identical across platforms — the phone and the browser once used
// different hashes and gave one set two different colours, which is exactly
// the ambiguity this module exists to remove. An explicit SetTileOverride
// wins when the student has chosen.

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
  'book',
  'flask',
  'globe',
  'monitor',
  'lightbulb',
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
    words: [
      'history',
      // `geog`, not `geo`: `geometry` is a maths set and belongs with the
      // lightbulb, not with a globe.
      'geog',
      'world',
      'politic',
      'global',
      'civic',
      'language',
      'culture',
      'spanish',
      'french',
    ],
  },
  {
    glyph: 'flask',
    words: ['chem', 'bio', 'lab', 'physic', 'science', 'anatomy', 'pharm', 'nurs', 'med'],
  },
  {
    glyph: 'book',
    words: ['lit', 'english', 'writing', 'essay', 'law', 'philos', 'read', 'poet', 'revision'],
  },
  {
    glyph: 'lightbulb',
    words: [
      'psych',
      'business',
      'econ',
      'market',
      'design',
      'idea',
      'theor',
      'concept',
      'logic',
      'math',
      'stat',
    ],
  },
];

/**
 * FNV-1a, 32-bit, with murmur3's finaliser.
 *
 * `setId` is a uuid, so what matters is that this is the SAME number on both
 * platforms and across sessions — which rules out `Math.random`, insertion
 * order and array index. The finaliser is not decoration: plain FNV-1a leaves
 * structure in its low bits and `% 6` reads only those, so without it 200
 * UUID-shaped ids landed on three of the six hues instead of all six. UUIDs
 * share long prefixes, which is exactly the input that exposes it.
 */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    // `Math.imul` because `h * 16777619` loses precision past 2^53.
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A set's own pick, from `study_sets.tile_hue` / `tile_glyph`. */
export interface SetTileOverride {
  hue?: string | null;
  glyph?: string | null;
}

export function isSetTileHue(value: unknown): value is SetTileHue {
  return typeof value === 'string' && (SET_TILE_HUES as readonly string[]).includes(value);
}

export function isSetTileGlyph(value: unknown): value is SetTileGlyph {
  return typeof value === 'string' && (SET_TILE_GLYPHS as readonly string[]).includes(value);
}

/**
 * The pastel + glyph a set's tile is drawn with.
 *
 * Without an `override` this is deterministic per set: `setId` alone decides
 * the hue, so the art never moves when a set is renamed — a tile that changed
 * colour on rename would stop being an identity.
 *
 * `override` is the student's own pick, and it WINS. The hash is a good
 * default, not a verdict: the reference lets a set be the mint monitor because
 * its owner said so. The two halves are independent — picking a hue and
 * leaving the glyph alone keeps the derived glyph, which is what a settings
 * screen with two separate rows of buttons has to mean.
 *
 * A value outside the six tables is IGNORED rather than rendered: these
 * columns come off a database row, and a hand-written `'chartreuse'` must draw
 * the derived tile rather than a hole where a tint should be. That is also why
 * the parameter is typed `string | null` and not `SetTileHue` — the caller is
 * passing untrusted row data, and saying so is more honest than a cast at
 * every call site.
 *
 * Callers still draw a cover picture over the result when the set has one:
 * cover > override > hash.
 */
export function setTileArt(
  setId: string,
  title?: string,
  override?: SetTileOverride | null
): { hue: SetTileHue; glyph: SetTileGlyph } {
  const seed = hash(setId || title || 'set');
  // `?? ` is unreachable — both tables are non-empty consts and the index is a
  // modulo of their length. It is here because the web app compiles with
  // noUncheckedIndexedAccess, which cannot see that.
  const hue = isSetTileHue(override?.hue)
    ? override.hue
    : (SET_TILE_HUES[seed % SET_TILE_HUES.length] ?? 'mint');

  if (isSetTileGlyph(override?.glyph)) return { hue, glyph: override.glyph };

  const needle = ` ${(title || '').toLowerCase()} `;
  for (const cue of GLYPH_CUES) {
    if (cue.words.some((word) => needle.includes(word))) {
      return { hue, glyph: cue.glyph };
    }
  }

  // No subject cue: spread on a different slice of the same hash so hue and
  // glyph do not move in lockstep (which would give six tile designs, not 36).
  const glyph = SET_TILE_GLYPHS[(seed >>> 8) % SET_TILE_GLYPHS.length] ?? 'layers';
  return { hue, glyph };
}

/* ------------------------------------------------------------- count chips */

/** What a set holds. Every field optional: a caller counts what it can see. */
// ---------------------------------------------------------------------------
// Count chips
// ---------------------------------------------------------------------------
// The "4 notes · 2 lectures · 1 deck" row. Zero counts produce no chip: an
// empty set should look empty rather than claim a zero of everything.

export interface SetCounts {
  materials?: number;
  notes?: number;
  lectures?: number;
  decks?: number;
  tests?: number;
  quizzes?: number;
}

export interface SetCountChip {
  kind: string;
  count: number;
  /** The full, spoken form — the card shows a glyph + number, screen readers get this. */
  label: string;
}

export interface SetCountChipOptions {
  /**
   * `title` → `4 Materials` (the web card's pills), `sentence` → `4 materials`
   * (the phone's). Only the casing differs; the words and the order do not.
   */
  labelCase?: 'title' | 'sentence';
}

const CHIP_ORDER: ReadonlyArray<{ kind: string; singular: string; plural: string }> = [
  { kind: 'materials', singular: 'Material', plural: 'Materials' },
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
 *
 * `notes` stands in for `materials` when a caller counts notes rather than
 * materials, so the two never both appear — a set cannot hold "4 materials"
 * AND "4 notes" when they are the same four objects counted twice.
 */
export function setCountChips(counts: SetCounts, options: SetCountChipOptions = {}): SetCountChip[] {
  const sentence = options.labelCase === 'sentence';
  const resolved: SetCounts = { ...counts, materials: counts.materials ?? counts.notes ?? 0 };
  const chips: SetCountChip[] = [];
  for (const entry of CHIP_ORDER) {
    const raw = resolved[entry.kind as keyof SetCounts];
    const count = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
    if (count <= 0) continue;
    const word = count === 1 ? entry.singular : entry.plural;
    chips.push({
      kind: entry.kind,
      count,
      label: `${count} ${sentence ? word.toLowerCase() : word}`,
    });
  }
  return chips;
}

/* ------------------------------------------------------ last-studied label */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** `2 Sep`. Locale-free, so it reads the same on a server, a phone and a test. */
// ---------------------------------------------------------------------------
// Last studied
// ---------------------------------------------------------------------------
// Relative where relative is useful ("Yesterday"), absolute once it is not.
// The never-studied wording is an OPTION, not a constant: the web card wraps
// it in "Last studied · {label}" and needs words, the phone card renders the
// line only when there is one and needs an empty string.

export function formatShortDate(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()] ?? ''}`.trim();
}

export interface RelativeStudiedOptions {
  /**
   * What to return when there is no usable stamp.
   *
   * The web card wraps this in `Last studied · {label}` and so needs words;
   * the phone's card renders the whole line only when the label is non-empty
   * and so needs `''`. See the file header.
   */
  emptyLabel?: string;
  /** Past this many days, an absolute date replaces the relative age. */
  absoluteAfterDays?: number;
  /** How that absolute date is written. */
  formatDate?: (date: Date) => string;
}

/**
 * `23m ago` — the relative form, because "how long since I touched this" is the
 * question a set list answers, and `9/13/2026` makes the reader do the
 * subtraction. Past `absoluteAfterDays` the relative form stops being
 * informative and the date is shown instead.
 *
 * A stamp in the FUTURE (a phone clock behind the server's) reads `Just now`
 * rather than a negative age.
 */
export function relativeStudiedLabel(
  iso: string | null | undefined,
  now: Date = new Date(),
  options: RelativeStudiedOptions = {}
): string {
  const {
    emptyLabel = 'Not studied yet',
    absoluteAfterDays = 28,
    formatDate = (date: Date) => date.toLocaleDateString(),
  } = options;

  const time = typeof iso === 'string' ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(time)) return emptyLabel;

  const delta = now.getTime() - time;
  if (delta < MINUTE) return 'Just now';
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
  if (delta < 2 * DAY) return 'Yesterday';
  if (delta < absoluteAfterDays * DAY) {
    const days = Math.floor(delta / DAY);
    // Weeks only once there are weeks to speak of, and only while the absolute
    // date is still further off than they are.
    if (days < 7) return `${days}d ago`;
    return `${Math.floor(days / 7)}w ago`;
  }
  return formatDate(new Date(time));
}
