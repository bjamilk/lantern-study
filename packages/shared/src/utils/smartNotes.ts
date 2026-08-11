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

/** Client-side request options for POST /notes/:id/summarize. */
export interface SmartNotesRequestOptions {
  /** Free-text goals, e.g. "focus on clinical applications". Server-sanitized. */
  guidance?: string;
  depth?: SmartNotesDepth;
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
