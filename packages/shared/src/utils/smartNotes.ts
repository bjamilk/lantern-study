/** Markers for the generated Smart Notes block inside a note body. */
export const SMART_NOTES_START = '<!-- lantern:smart-notes:start -->';
export const SMART_NOTES_END = '<!-- lantern:smart-notes:end -->';
export const SMART_NOTES_HEADING = '## Smart Notes';

/** Default map-reduce chunking for long transcripts / PDFs. */
export const SMART_NOTES_CHUNK_SIZE = 6000;
export const SMART_NOTES_CHUNK_OVERLAP = 200;
export const SMART_NOTES_MAX_CHUNKS = 6;

/** Output depth presets for Smart Notes generation. */
export type SmartNotesDepth = 'concise' | 'standard' | 'deep';

export const SMART_NOTES_DEPTHS: readonly SmartNotesDepth[] = ['concise', 'standard', 'deep'];

/** Max characters of free-text guidance accepted by the summarize endpoint. */
export const SMART_NOTES_GUIDANCE_MAX_CHARS = 500;

/** Which materials Smart Notes may read when a note has more than one source. */
export const SMART_NOTE_SOURCE_IDS = [
  'typed',
  'transcript',
  'document',
  'youtube',
  'photos',
] as const;

export type SmartNoteSourceId = (typeof SMART_NOTE_SOURCE_IDS)[number];

export const SMART_NOTE_SOURCE_LABELS: Record<SmartNoteSourceId, string> = {
  typed: 'My notes',
  transcript: 'Transcript',
  document: 'Document',
  youtube: 'YouTube',
  photos: 'Photos',
};

/** Uploaded file / video / photos — one chip on Enhanced compose. */
export const SMART_NOTE_MATERIAL_SOURCE_IDS = ['document', 'youtube', 'photos'] as const;

export type SmartNoteMaterialSourceId = (typeof SMART_NOTE_MATERIAL_SOURCE_IDS)[number];

export const SMART_NOTE_FILTER_IDS = ['typed', 'transcript', 'materials'] as const;

export type SmartNoteFilterId = (typeof SMART_NOTE_FILTER_IDS)[number];

export const SMART_NOTE_FILTER_LABELS: Record<SmartNoteFilterId, string> = {
  typed: 'My notes',
  transcript: 'Transcript',
  materials: 'Materials',
};

export function isMaterialSmartNoteSource(id: SmartNoteSourceId): boolean {
  return (SMART_NOTE_MATERIAL_SOURCE_IDS as readonly string[]).includes(id);
}

/** Chips shown on Enhanced compose: My notes, Transcript, Materials. */
export function listSmartNoteFilters(sources: readonly SmartNoteSourceId[]): SmartNoteFilterId[] {
  const filters: SmartNoteFilterId[] = [];
  if (sources.includes('typed')) filters.push('typed');
  if (sources.includes('transcript')) filters.push('transcript');
  if (sources.some(isMaterialSmartNoteSource)) filters.push('materials');
  return filters;
}

export function materialSourceIdsFrom(
  sources: readonly SmartNoteSourceId[]
): SmartNoteSourceId[] {
  return sources.filter(isMaterialSmartNoteSource);
}

export function smartNoteFilterSelected(
  filter: SmartNoteFilterId,
  selected: readonly SmartNoteSourceId[],
  available: readonly SmartNoteSourceId[]
): boolean {
  const target = filter === 'materials' ? materialSourceIdsFrom(available) : [filter];
  return target.length > 0 && target.every((id) => selected.includes(id));
}

export function toggleSmartNoteFilter(
  filter: SmartNoteFilterId,
  selected: readonly SmartNoteSourceId[],
  available: readonly SmartNoteSourceId[]
): SmartNoteSourceId[] {
  const target = filter === 'materials' ? materialSourceIdsFrom(available) : available.filter((id) => id === filter);
  const on = target.length > 0 && target.every((id) => selected.includes(id));
  if (on) return selected.filter((id) => !target.includes(id));
  const next = [...selected];
  for (const id of target) {
    if (!next.includes(id)) next.push(id);
  }
  return next;
}

/** Parse `sources` from a summarize body. `undefined` means the legacy full merge. */
export function parseSmartNoteSources(raw: unknown): SmartNoteSourceId[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const allowed = new Set<string>(SMART_NOTE_SOURCE_IDS);
  const next: SmartNoteSourceId[] = [];
  for (const value of raw) {
    if (typeof value !== 'string' || !allowed.has(value)) continue;
    const id = value as SmartNoteSourceId;
    if (!next.includes(id)) next.push(id);
  }
  return next;
}

/** Client-side request options for POST /notes/:id/summarize. */
export interface SmartNotesRequestOptions {
  /** Free-text goals, e.g. "focus on clinical applications". Server-sanitized. */
  guidance?: string;
  depth?: SmartNotesDepth;
  /** When set, only these materials are synthesized. Omitted = current full merge. */
  sources?: SmartNoteSourceId[];
}

const MARKER_SECTION_RE = new RegExp(
  `${escapeRegExp(SMART_NOTES_START)}[\\s\\S]*?${escapeRegExp(SMART_NOTES_END)}`,
  'gi'
);

/** Legacy unscoped "## Smart Notes" block through end of document (or next top-level H2 that isn't a subsection of generated notes). */
const LEGACY_HEADING_RE = /^##\s+Smart Notes\s*$/im;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Remove a previous Smart Notes section so regenerations do not recycle it. */
export function stripSmartNotesSection(text: string | null | undefined): string {
  if (!text) return '';
  let next = text.replace(MARKER_SECTION_RE, '');
  const legacyMatch = LEGACY_HEADING_RE.exec(next);
  if (legacyMatch && legacyMatch.index != null) {
    next = next.slice(0, legacyMatch.index);
  }
  return next.replace(/\n{3,}/g, '\n\n').trim();
}

/** Extract markdown inside an existing Smart Notes section, if present. */
export function extractSmartNotesSection(text: string | null | undefined): string | null {
  if (!text) return null;
  const marked = new RegExp(
    `${escapeRegExp(SMART_NOTES_START)}\\s*(?:${escapeRegExp(SMART_NOTES_HEADING)}\\s*)?([\\s\\S]*?)${escapeRegExp(SMART_NOTES_END)}`,
    'i'
  ).exec(text);
  if (marked?.[1]) return marked[1].trim() || null;

  const legacy = LEGACY_HEADING_RE.exec(text);
  if (!legacy || legacy.index == null) return null;
  return text.slice(legacy.index + legacy[0].length).trim() || null;
}

/**
 * Append or replace a clearly marked Smart Notes section without wiping
 * user-written content above it.
 */
export function upsertSmartNotesSection(
  body: string | null | undefined,
  smartNotesMarkdown: string
): string {
  const notes = smartNotesMarkdown.trim();
  if (!notes) return stripSmartNotesSection(body);

  const section = `${SMART_NOTES_START}\n${SMART_NOTES_HEADING}\n\n${notes}\n${SMART_NOTES_END}`;
  const base = stripSmartNotesSection(body);
  if (!base) return `${section}\n`;
  return `${base.trimEnd()}\n\n${section}\n`;
}

export type ChunkTextOptions = {
  chunkSize?: number;
  maxChunks?: number;
  overlap?: number;
};

/**
 * Split long source text into overlapping chunks for map-reduce Smart Notes.
 * Prefers paragraph boundaries; hard-caps at maxChunks so one note cannot
 * burn the full daily AI quota.
 */
export function chunkTextForSmartNotes(
  text: string,
  options: ChunkTextOptions = {}
): string[] {
  const chunkSize = options.chunkSize ?? SMART_NOTES_CHUNK_SIZE;
  const maxChunks = options.maxChunks ?? SMART_NOTES_MAX_CHUNKS;
  const overlap = options.overlap ?? SMART_NOTES_CHUNK_OVERLAP;
  const cleaned = text.replace(/\r\n/g, '\n').trim();
  if (!cleaned) return [];
  if (cleaned.length <= chunkSize) return [cleaned];

  const chunks: string[] = [];
  let start = 0;

  while (start < cleaned.length && chunks.length < maxChunks) {
    let end = Math.min(start + chunkSize, cleaned.length);

    if (end < cleaned.length) {
      const window = cleaned.slice(start, end);
      const paraBreak = window.lastIndexOf('\n\n');
      const lineBreak = window.lastIndexOf('\n');
      const splitAt =
        paraBreak >= Math.floor(chunkSize * 0.45)
          ? paraBreak + 2
          : lineBreak >= Math.floor(chunkSize * 0.55)
            ? lineBreak + 1
            : chunkSize;
      end = start + splitAt;
    }

    const piece = cleaned.slice(start, end).trim();
    if (piece) chunks.push(piece);

    if (end >= cleaned.length) break;
    start = Math.max(0, end - overlap);
    if (chunks.length === maxChunks - 1 && start < cleaned.length) {
      // Last allowed chunk: take remaining (capped) so the ending is not dropped silently.
      const tail = cleaned.slice(start, start + chunkSize).trim();
      if (tail) chunks.push(tail);
      break;
    }
  }

  return chunks;
}

// ─── Keyword-overlap chunk retrieval (grounded tutor) ────────────────────────
//
// The note-scoped tutor must answer from the WHOLE document, not the first N
// characters of it. Embeddings and a vector store would do that, but both cost
// money per note and neither survives the free-tier provider cascade this app
// runs on. Keyword overlap over the chunks we already produce for Smart Notes
// is cheap, deterministic, testable, and good enough at note scale (a note is
// tens of KB, not a corpus).
//
// The output feeds a prompt, so the numbers below are also a cost control:
// 3 x 1200 chars is a SMALLER prompt than the flat 4000-char prefix it
// replaces, while being able to reach the end of a long document.

/** Chunk size used when splitting a document for tutor retrieval. */
export const TUTOR_CHUNK_SIZE = 1200;
/** Overlap between tutor chunks, so a fact split across a boundary survives. */
export const TUTOR_CHUNK_OVERLAP = 120;
/** Ceiling on chunks considered — caps CPU and bounds the document we can reach. */
export const TUTOR_MAX_CHUNKS = 24;
/** Chunks handed to the model for one question. */
export const TUTOR_CHUNKS_PER_QUESTION = 3;

/**
 * Words that carry no retrieval signal in a study question. Includes the
 * question verbs ("explain", "summarize") — a query made only of these has no
 * topic to match on, which is what triggers the `leading` fallback below.
 */
const CHUNK_QUERY_STOPWORDS = new Set([
  'about', 'after', 'again', 'all', 'already', 'also', 'and', 'another', 'any',
  'are', 'ask', 'because', 'been', 'before', 'being', 'below', 'better',
  'between', 'both', 'but', 'can', 'cannot', 'could', 'define', 'describe',
  'did', 'does', 'doing', 'done', 'down', 'during', 'each', 'else', 'even',
  'ever', 'every', 'explain', 'few', 'for', 'from', 'further', 'get', 'give',
  'goes', 'going', 'gonna', 'got', 'had', 'has', 'have', 'having', 'help',
  'her', 'here', 'hers', 'him', 'his', 'how', 'into', 'its', 'just', 'know',
  'let', 'like', 'make', 'many', 'may', 'mean', 'means', 'might', 'more',
  'most', 'much', 'must', 'need', 'nor', 'not', 'note', 'notes', 'now', 'off',
  'once', 'one', 'only', 'other', 'our', 'out', 'over', 'own', 'part',
  'please', 'point', 'points', 'question', 'questions', 'quick', 'quickly',
  'really', 'said', 'same', 'say', 'see', 'she', 'should', 'show', 'simple',
  'simply', 'some', 'such', 'summarise', 'summarize', 'summary', 'sure',
  'take', 'tell', 'than', 'that', 'the', 'their', 'them', 'then', 'there',
  'these', 'they', 'thing', 'things', 'this', 'those', 'through', 'too',
  'topic', 'topics', 'under', 'until', 'use', 'used', 'using', 'very', 'want',
  'was', 'way', 'well', 'were', 'what', 'when', 'where', 'which', 'while',
  'who', 'whom', 'why', 'will', 'with', 'would', 'you', 'your', 'yours',
]);

/**
 * Crude plural folding so "mitochondria"/"mitochondrion" style near-misses do
 * not silently drop a chunk. Deliberately not a real stemmer: a wrong stem
 * costs a slightly worse excerpt, a dependency costs every bundle.
 */
function stemChunkTerm(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  // Strip one trailing "s" only. "-ss", "-us" and "-is" endings are left alone
  // so words that are already singular ("glycolysis", "class", "nucleus") are
  // not mangled into a stem their own plural would never produce.
  if (token.length > 3 && token.endsWith('s') && !/(?:ss|us|is)$/.test(token)) {
    return token.slice(0, -1);
  }
  return token;
}

function tokenizeChunkText(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
}

/** Distinct, stemmed, stopword-free search terms from a student's question. */
export function extractQueryKeywords(query: string): string[] {
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const token of tokenizeChunkText(query || '')) {
    if (CHUNK_QUERY_STOPWORDS.has(token)) continue;
    const stem = stemChunkTerm(token);
    if (stem.length < 3 || seen.has(stem)) continue;
    seen.add(stem);
    keywords.push(stem);
  }
  return keywords;
}

export interface SelectedChunk {
  /** Position in the source document, 0-based — used to label excerpts honestly. */
  index: number;
  text: string;
  /** Overlap score; 0 for chunks picked by the `leading` fallback. */
  score: number;
  /** Query terms this chunk actually contains. */
  matchedTerms: string[];
}

export type ChunkSelectionStrategy =
  /** At least one query term matched — these excerpts answer THIS question. */
  | 'keyword'
  /** No usable query terms, or none matched — document opening used instead. */
  | 'leading'
  /** Nothing to select from. */
  | 'none';

export interface ChunkSelection {
  chunks: SelectedChunk[];
  strategy: ChunkSelectionStrategy;
  /** Total chunks the document was split into (what `chunks` was drawn from). */
  totalChunks: number;
}

export interface SelectRelevantChunksOptions {
  /** Max chunks to return (default TUTOR_CHUNKS_PER_QUESTION). */
  limit?: number;
}

/**
 * Rank chunks by keyword overlap with a question and return the best few.
 *
 * Terms are weighted by how rare they are across the document, so a word that
 * appears in every chunk (usually the note's own subject) cannot decide the
 * ranking on its own. Ties break toward the earlier chunk so output is stable
 * — a tutor that returns different excerpts for the same question every time
 * is impossible to debug or cache.
 */
export function selectRelevantChunks(
  chunks: string[],
  query: string,
  options: SelectRelevantChunksOptions = {}
): ChunkSelection {
  const limit = Math.max(1, options.limit ?? TUTOR_CHUNKS_PER_QUESTION);
  const usable = (chunks || []).filter((chunk) => typeof chunk === 'string' && chunk.trim().length > 0);
  if (usable.length === 0) return { chunks: [], strategy: 'none', totalChunks: 0 };

  const leading = (): ChunkSelection => ({
    chunks: usable.slice(0, limit).map((text, index) => ({
      index,
      text,
      score: 0,
      matchedTerms: [],
    })),
    strategy: 'leading',
    totalChunks: usable.length,
  });

  const keywords = extractQueryKeywords(query);
  if (keywords.length === 0) return leading();

  const termCounts: Array<Map<string, number>> = usable.map((chunk) => {
    const counts = new Map<string, number>();
    for (const token of tokenizeChunkText(chunk)) {
      const stem = stemChunkTerm(token);
      counts.set(stem, (counts.get(stem) || 0) + 1);
    }
    return counts;
  });

  const documentFrequency = new Map<string, number>();
  for (const keyword of keywords) {
    documentFrequency.set(
      keyword,
      termCounts.reduce((total, counts) => total + (counts.has(keyword) ? 1 : 0), 0)
    );
  }

  const scored = usable.map((text, index) => {
    const counts = termCounts[index] ?? new Map<string, number>();
    let score = 0;
    const matchedTerms: string[] = [];
    for (const keyword of keywords) {
      const tf = counts.get(keyword) || 0;
      if (tf === 0) continue;
      matchedTerms.push(keyword);
      const df = documentFrequency.get(keyword) || 1;
      const idf = Math.log(1 + usable.length / df);
      score += idf * (1 + Math.log(tf));
    }
    return { index, text, score, matchedTerms };
  });

  const hits = scored
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .slice(0, limit);

  if (hits.length === 0) return leading();

  // Reading order, so multi-excerpt answers follow the document rather than
  // the score ranking.
  return {
    chunks: hits.slice().sort((a, b) => a.index - b.index),
    strategy: 'keyword',
    totalChunks: usable.length,
  };
}

/**
 * One-shot: split a document with the tutor's chunk settings and pick the
 * excerpts that answer `query`.
 */
export function selectDocumentExcerptsForQuestion(
  document: string,
  query: string,
  options: SelectRelevantChunksOptions & ChunkTextOptions = {}
): ChunkSelection {
  const chunks = chunkTextForSmartNotes(document || '', {
    chunkSize: options.chunkSize ?? TUTOR_CHUNK_SIZE,
    maxChunks: options.maxChunks ?? TUTOR_MAX_CHUNKS,
    overlap: options.overlap ?? TUTOR_CHUNK_OVERLAP,
  });
  return selectRelevantChunks(chunks, query, { limit: options.limit });
}
