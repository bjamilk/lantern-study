/**
 * How a study SET presents itself in a list: its tile art, its count chips and
 * its "last studied" line.
 *
 * Three pure functions, no React and no react-native import, so the node jest
 * environment this project runs can test them — and so the same three can be
 * lifted verbatim into `packages/shared/src/study/setPresentation.ts` when the
 * web lane's copy and this one are deduped. Nothing here may import from the
 * app: that is the whole point of the file.
 *
 * WHY TILE ART IS DERIVED AND NOT STORED. Every set in the hub drew the one
 * mint `layers` disc (the SF2 device pass: "one fixed mint layers glyph for
 * every set"), so four sets read as four copies of the same object and the
 * list could only be scanned by reading titles. StudyFetch hand-picks a tile
 * per set; we have no picker and no column to store one in, so the art is a
 * stable function of the set's id — the same set is the same colour on every
 * device, on every launch, for ever, with no migration and no write.
 */

/** The six StudyFetch pastels a set tile can take. */
export type SetTileHue = 'mint' | 'peach' | 'lilac' | 'lime' | 'sky' | 'butter';

/** The six glyphs a set tile can carry. */
export type SetTileGlyph = 'layers' | 'monitor' | 'lightbulb' | 'book' | 'flask' | 'globe';

const HUES: readonly SetTileHue[] = ['mint', 'peach', 'lilac', 'lime', 'sky', 'butter'];
const GLYPHS: readonly SetTileGlyph[] = [
  'layers',
  'monitor',
  'lightbulb',
  'book',
  'flask',
  'globe',
];

/**
 * FNV-1a, 32-bit. Chosen over "sum the char codes" because the ids in play are
 * UUIDs that share long prefixes and a character sum spreads them badly — two
 * sets created in the same second would land on the same hue far too often.
 */
function hash32(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    // `Math.imul` because `h * 16777619` loses precision past 2^53.
    h = Math.imul(h, 0x01000193);
  }
  // Final avalanche (murmur3's finaliser). Plain FNV-1a leaves structure in
  // its low bits, and `% 6` reads only those: without this, 200 UUID-shaped
  // ids landed on three of the six hues instead of all six.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Title keywords that mean a glyph better than a hash does.
 *
 * Deliberately small and deliberately last-resort: a set called "Organic
 * Chemistry" gets the flask, and everything else keeps the hashed glyph rather
 * than being force-fitted into a category we cannot actually read.
 */
const GLYPH_KEYWORDS: ReadonlyArray<{ glyph: SetTileGlyph; words: readonly string[] }> = [
  { glyph: 'flask', words: ['chem', 'lab', 'bio', 'physic', 'science', 'pharm', 'anatomy'] },
  { glyph: 'globe', words: ['geo', 'history', 'world', 'politic', 'language', 'spanish', 'french'] },
  { glyph: 'monitor', words: ['comput', 'code', 'program', 'software', 'data', 'digital', 'cs '] },
  { glyph: 'book', words: ['lit', 'read', 'english', 'essay', 'writing', 'exam', 'revision'] },
  { glyph: 'lightbulb', words: ['theory', 'concept', 'idea', 'philosoph', 'psych', 'logic'] },
];

/**
 * The hue and glyph for one set.
 *
 * `setId` alone decides the hue, so the art never moves when a set is renamed
 * — a tile that changed colour on rename would stop being an identity.
 */
export function setTileArt(setId: string, title?: string): { hue: SetTileHue; glyph: SetTileGlyph } {
  const h = hash32(setId || '');
  const hue = HUES[h % HUES.length]!;
  const keyed = glyphForTitle(title);
  // `>>> 8` so the glyph is not a function of the same low bits as the hue:
  // with both off `h % 6` every mint set in the app would carry `layers`.
  const glyph = keyed ?? GLYPHS[(h >>> 8) % GLYPHS.length]!;
  return { hue, glyph };
}

function glyphForTitle(title?: string): SetTileGlyph | null {
  const text = (title || '').toLowerCase();
  if (!text) return null;
  for (const row of GLYPH_KEYWORDS) {
    if (row.words.some((word) => text.includes(word))) return row.glyph;
  }
  return null;
}

/** What a set holds. Every field optional: a caller counts what it can see. */
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
  label: string;
}

/**
 * The count chips for a set, in reading order, with the zeros dropped.
 *
 * Dropping zeros is the point: "4 materials · 0 lectures · 0 decks · 0 tests"
 * is four chips of which one carries information. `notes` stands in for
 * `materials` when a caller counts notes rather than materials, so the two
 * never both appear.
 */
export function setCountChips(counts: SetCounts): SetCountChip[] {
  const materials = counts.materials ?? counts.notes ?? 0;
  const rows: ReadonlyArray<{ kind: string; count: number; one: string; many: string }> = [
    { kind: 'materials', count: materials, one: 'material', many: 'materials' },
    { kind: 'lectures', count: counts.lectures ?? 0, one: 'lecture', many: 'lectures' },
    { kind: 'decks', count: counts.decks ?? 0, one: 'deck', many: 'decks' },
    { kind: 'tests', count: counts.tests ?? 0, one: 'test', many: 'tests' },
    { kind: 'quizzes', count: counts.quizzes ?? 0, one: 'quiz', many: 'quizzes' },
  ];
  const chips: SetCountChip[] = [];
  for (const row of rows) {
    if (!Number.isFinite(row.count) || row.count <= 0) continue;
    const n = Math.floor(row.count);
    chips.push({ kind: row.kind, count: n, label: `${n} ${n === 1 ? row.one : row.many}` });
  }
  return chips;
}

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

/**
 * "Just now" / "23m ago" / "2h ago" / "Yesterday" / "3d ago" / "12 Sep".
 *
 * Returns `''` — not "never" — when there is no stamp. A set made a minute ago
 * has never been studied, and "Last studied never" tells a student off for a
 * set they have only just named; the caller draws nothing instead.
 *
 * A stamp in the FUTURE (a phone clock behind the server's) reads "Just now"
 * rather than a negative age.
 */
export function relativeStudiedLabel(iso: string | null | undefined, now?: Date): string {
  const stamp = typeof iso === 'string' ? Date.parse(iso) : NaN;
  if (!Number.isFinite(stamp)) return '';
  const at = now ? now.getTime() : Date.now();
  const minutes = Math.floor((at - stamp) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  const date = new Date(stamp);
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}
