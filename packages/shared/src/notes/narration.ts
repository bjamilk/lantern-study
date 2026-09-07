/**
 * The narration model — "read this document to me", as data.
 *
 * There is no video and no server-generated audio anywhere in this feature.
 * The server writes a SCRIPT: one short spoken paragraph per page of an
 * uploaded document, stored beside the page model. A client plays it by
 * showing the rendered page image and speaking the segment on the device
 * (`speechSynthesis` on web, `expo-speech` on mobile). That is what makes a
 * deck playable offline and free to replay — the bytes are text and a few
 * page pictures, not a media file.
 *
 * Everything in this file is pure: no I/O, no platform APIs, no prompts. Web
 * and mobile derive the same duration, the same current segment and the same
 * player state from the same rows, and the server uses the same planner to
 * decide how many model calls a document needs. Anything that talks to a model
 * or a database lives in apps/api-server/src/services/narrationService.ts.
 */

/**
 * One page's spoken paragraph, AS STORED AND SENT.
 *
 * Deliberately a superset of the player's `NarrationSegment` in
 * ./narrationPlayer: the player only needs `pageIndex`, `text` and the
 * estimate fields, so a row of this shape can be handed to it unchanged. The
 * extra fields are the server's own bookkeeping — `order` is what makes the
 * script's front-to-back order a stored fact rather than a re-derivation, and
 * the two estimate fields are what let a client say "about 6 minutes" before
 * a single word has been spoken.
 */
export interface NarrationScriptSegment {
  /** 0-based, and it matches `note_attachment_pages.page_index` exactly. */
  pageIndex: number;
  /**
   * Playback order across the whole script, 0-based.
   *
   * Separate from `pageIndex` because a long page may one day be split into
   * two segments, and because a document whose first pages are blank starts at
   * order 0 on page 3. Order is what the player advances; pageIndex is what the
   * viewer shows.
   */
  order: number;
  /** What the device speaks. Plain sentences — no markdown, no headings. */
  text: string;
  /** How long this is expected to take at a normal reading pace. */
  estimatedSeconds: number;
  /**
   * Where this segment starts, in milliseconds from the top of the deck, and
   * how long it is expected to run.
   *
   * ESTIMATES, never measurements — on-device speech runs at whatever rate the
   * student picked on whatever engine their phone shipped with. They exist so
   * the player can print a length up front; nothing may present them as a
   * timeline or use them to decide position.
   */
  startMs: number;
  durationMs: number;
}

/** A whole document's narration, as the row stores it and the API returns it. */
export interface NarrationScriptRow {
  /** The attachment this narrates. The player calls the same field sourceId. */
  sourceId: string;
  /**
   * Bumped when a script is deliberately regenerated. Together with the
   * attachment and the user it is the idempotency key: a retry at the same
   * version returns the script that already exists and is never charged twice.
   */
  version: number;
  /** How many pages the server actually read — never how many the file has. */
  pageCount: number;
  segments: NarrationScriptSegment[];
  /** When the script was written, so a stale offline copy can be dated. */
  createdAt?: string;
}

/**
 * Speaking pace used for every estimate, in words per minute.
 *
 * 150 is unhurried speech — slower than the ~180 wpm a browser voice defaults
 * to. An estimate that runs slightly long is the safe direction: a progress bar
 * that finishes early reads as a bonus, one that stalls at 98% reads as broken.
 */
export const NARRATION_WORDS_PER_MINUTE = 150;

/** No segment is estimated at less than this; even one word takes a moment. */
export const NARRATION_MIN_SEGMENT_SECONDS = 2;

/** Longest single page paragraph we will keep. Past this the text is trimmed. */
export const NARRATION_MAX_SEGMENT_CHARS = 1200;

/** How many pages the script generator sends to the model in one call. */
export const NARRATION_PAGES_PER_BATCH = 4;

/** Below this a page has nothing worth narrating (a divider, a blank scan). */
export const NARRATION_MIN_PAGE_TEXT_CHARS = 12;

function wordCount(text: string): number {
  const trimmed = String(text || '').trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/** How long one paragraph takes to speak, rounded up to whole seconds. */
export function estimateNarrationSeconds(text: string): number {
  const words = wordCount(text);
  if (words <= 0) return 0;
  const seconds = Math.ceil((words / NARRATION_WORDS_PER_MINUTE) * 60);
  return Math.max(NARRATION_MIN_SEGMENT_SECONDS, seconds);
}

/**
 * How long the whole deck takes, in seconds.
 *
 * Accepts a script or a bare segment list so the player can estimate what is
 * LEFT (`narrationDuration(segments.slice(index))`) with the same function that
 * priced the whole thing.
 */
export function narrationDuration(
  script: NarrationScriptRow | NarrationScriptSegment[] | null | undefined
): number {
  if (!script) return 0;
  const segments = Array.isArray(script) ? script : script.segments;
  if (!Array.isArray(segments)) return 0;
  return segments.reduce((total, segment) => {
    const seconds =
      typeof segment?.estimatedSeconds === 'number' && Number.isFinite(segment.estimatedSeconds)
        ? Math.max(0, segment.estimatedSeconds)
        : estimateNarrationSeconds(segment?.text || '');
    return total + seconds;
  }, 0);
}

/** "About 6 min" / "About 40 sec" — one way to print a length, both platforms. */
export function formatNarrationDuration(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
  if (total < 60) return `About ${Math.max(1, total)} sec`;
  const minutes = Math.round(total / 60);
  return `About ${minutes} min`;
}

/**
 * The segment to speak while page N is on screen, or null when that page has
 * none.
 *
 * Null is a real answer, not a gap to paper over: a page with no readable text
 * gets no segment, and the player should show the page silently and say so
 * rather than reading the previous page's words over a new picture.
 */
export function segmentForPage(
  script: NarrationScriptRow | NarrationScriptSegment[] | null | undefined,
  pageIndex: number
): NarrationScriptSegment | null {
  const segments = Array.isArray(script) ? script : script?.segments;
  if (!Array.isArray(segments)) return null;
  const matches = segments.filter((segment) => segment?.pageIndex === pageIndex);
  if (!matches.length) return null;
  return matches.reduce((first, segment) => (segment.order < first.order ? segment : first));
}

/** Every segment for one page, in order — for a page split across segments. */
export function segmentsForPage(
  script: NarrationScriptRow | NarrationScriptSegment[] | null | undefined,
  pageIndex: number
): NarrationScriptSegment[] {
  const segments = Array.isArray(script) ? script : script?.segments;
  if (!Array.isArray(segments)) return [];
  return segments
    .filter((segment) => segment?.pageIndex === pageIndex)
    .sort((a, b) => a.order - b.order);
}

/** The shape the planner needs. Matches `NotePageRecord` structurally. */
export interface NarrationPageLike {
  pageIndex: number;
  text?: string | null;
}

/** One model call's worth of pages. */
export interface NarrationBatch {
  /** Position of this batch in the run, 0-based. Drives job progress. */
  index: number;
  pages: Array<{ pageIndex: number; text: string }>;
}

export interface NarrationPlan {
  /** Pages the run covers, in order — including the blank ones. */
  pageIndexes: number[];
  /** Pages with too little text to narrate. They get no segment at all. */
  blankPageIndexes: number[];
  /** The model calls, in order. Empty when every page is blank. */
  batches: NarrationBatch[];
  /** True when the document had more pages than the run will read. */
  truncated: boolean;
}

/**
 * Split a document into the model calls that will write its script.
 *
 * Pure, so the cost of a document can be reasoned about (and tested) without a
 * database: batches × one call, plus one merge pass, is exactly the arithmetic
 * `NARRATION_CREDIT_COST` was set from.
 *
 * Blank pages are deliberately kept OUT of the batches and reported separately.
 * Sending "page 7: (nothing)" to a model invites it to invent page 7, which is
 * the one thing a narration must never do — a student listening with the page
 * in front of them would hear a description of something that is not there.
 */
export function planNarrationBatches(
  pages: NarrationPageLike[],
  options?: { batchSize?: number; maxPages?: number }
): NarrationPlan {
  const batchSize = Math.max(1, Math.floor(options?.batchSize ?? NARRATION_PAGES_PER_BATCH));
  const maxPages =
    options?.maxPages != null && Number.isFinite(options.maxPages)
      ? Math.max(0, Math.floor(options.maxPages))
      : Number.POSITIVE_INFINITY;

  const ordered = (Array.isArray(pages) ? pages : [])
    .filter((page) => page && Number.isInteger(page.pageIndex) && page.pageIndex >= 0)
    .sort((a, b) => a.pageIndex - b.pageIndex);

  const kept = maxPages === Number.POSITIVE_INFINITY ? ordered : ordered.slice(0, maxPages);
  const truncated = kept.length < ordered.length;

  const pageIndexes: number[] = [];
  const blankPageIndexes: number[] = [];
  const narratable: Array<{ pageIndex: number; text: string }> = [];

  for (const page of kept) {
    pageIndexes.push(page.pageIndex);
    const text = String(page.text || '').trim();
    if (text.length < NARRATION_MIN_PAGE_TEXT_CHARS) {
      blankPageIndexes.push(page.pageIndex);
      continue;
    }
    narratable.push({ pageIndex: page.pageIndex, text });
  }

  const batches: NarrationBatch[] = [];
  for (let i = 0; i < narratable.length; i += batchSize) {
    batches.push({ index: batches.length, pages: narratable.slice(i, i + batchSize) });
  }

  return { pageIndexes, blankPageIndexes, batches, truncated };
}

/**
 * Turn whatever came back from the model into segments that are safe to store.
 *
 * Three rules, each of which has a failure it prevents:
 *   - a segment whose page is not in `allowedPageIndexes` is dropped, so a
 *     model that renumbers pages cannot make the player show page 3 while
 *     speaking about page 9;
 *   - empty text is dropped rather than stored as a silent segment;
 *   - `order` is re-derived here, never trusted, so the script always plays
 *     front to back even if the model returned its pages shuffled.
 */
export function narrationSegmentsFromModel(
  raw: Array<{ pageIndex?: unknown; text?: unknown }> | null | undefined,
  allowedPageIndexes: number[]
): NarrationScriptSegment[] {
  const allowed = new Set(allowedPageIndexes);
  const seen = new Set<number>();
  const cleaned: Array<{ pageIndex: number; text: string }> = [];

  for (const entry of Array.isArray(raw) ? raw : []) {
    const pageIndex = Math.floor(Number(entry?.pageIndex));
    if (!Number.isFinite(pageIndex) || !allowed.has(pageIndex) || seen.has(pageIndex)) continue;
    const text = String(entry?.text ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, NARRATION_MAX_SEGMENT_CHARS);
    if (!text) continue;
    seen.add(pageIndex);
    cleaned.push({ pageIndex, text });
  }

  let startMs = 0;
  return cleaned
    .sort((a, b) => a.pageIndex - b.pageIndex)
    .map((entry, order) => {
      const estimatedSeconds = estimateNarrationSeconds(entry.text);
      const durationMs = estimatedSeconds * 1000;
      const segment: NarrationScriptSegment = {
        pageIndex: entry.pageIndex,
        order,
        text: entry.text,
        estimatedSeconds,
        startMs,
        durationMs,
      };
      startMs += durationMs;
      return segment;
    });
}

/** Status of a stored script, as the API reports it. */
export type NarrationScriptStatus = 'queued' | 'generating' | 'ready' | 'failed';

/**
 * Why there is no script to play, when there is none.
 *
 * `schema_missing` is the hand-applied-migration case and reads exactly like
 * the page model's: the feature says it is not available yet rather than
 * pretending the document cannot be read.
 */
export type NarrationUnavailableReason =
  | 'schema_missing'
  | 'no_pages'
  | 'not_generated'
  | 'failed';
