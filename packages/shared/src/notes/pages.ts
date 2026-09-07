/**
 * Pure helpers over the page model (`note_attachment_pages`).
 *
 * Everything here is deliberately free of I/O and of platform APIs so web and
 * mobile derive the SAME plan panel from the same rows. The server owns the
 * page text; this file only decides how to label and pace it.
 */

/** The shape the plan panel needs. Matches `NoteAttachmentPage` structurally. */
export interface PageLike {
  pageIndex: number;
  text?: string | null;
  charCount?: number | null;
}

/** One row of the walk-through plan panel. */
export interface PageHeading {
  /** 0-based, straight from the row. */
  pageIndex: number;
  /** What to show in the plan. Never empty — falls back to "Page N". */
  title: string;
  /**
   * False when the page carries no usable text (a full-page diagram, a blank
   * separator, a page OCR could not read). The panel should say so rather than
   * showing a confident-looking title over nothing, and "quiz me on this page"
   * has nothing to work with.
   */
  hasText: boolean;
  /**
   * True when `title` came from a line that actually looks like a heading, as
   * opposed to the first sentence of body text or the "Page N" fallback. Lets
   * the UI style a real heading differently from a guess.
   */
  isDerived: boolean;
}

/** Longest heading we will show before truncating. Plan rows are one line. */
const MAX_HEADING_CHARS = 80;
/** How far down a page to look before giving up on finding a heading. */
const MAX_LINES_SCANNED = 6;
/** Below this a page has nothing to walk through or quiz on. */
const MIN_PAGE_TEXT_CHARS = 12;

function normalizeLine(line: string): string {
  return line
    .replace(/\s+/g, ' ')
    .replace(/^[#*\s>\-–—•·]+/, '')
    .replace(/[*_`]+$/, '')
    .trim();
}

/** Page furniture: "3", "- 12 -", "Page 4 of 20", "iv". */
function isPageFurniture(line: string): boolean {
  if (!line) return true;
  if (!/[A-Za-z0-9]/.test(line)) return true;
  if (/^[-–—\s]*\d+[-–—\s]*$/.test(line)) return true;
  if (/^page\s+\d+(\s+of\s+\d+)?$/i.test(line)) return true;
  if (/^[ivxlcdm]+$/i.test(line) && line.length <= 6) return true;
  return false;
}

/**
 * Does this line read like a heading rather than a sentence? Four independent
 * signals, any one of which is enough:
 *
 *   - it was marked as one (`# Heading`, in text extracted from markdown);
 *   - it is numbered like an outline entry ("3.2 Enzyme kinetics");
 *   - it is short and does not end in sentence punctuation;
 *   - it is short and shouty (ALL CAPS), which is how slide titles survive OCR.
 *
 * A long line is never a heading no matter what else is true — a paragraph that
 * happens to lack a full stop is still a paragraph.
 */
function looksLikeHeading(rawLine: string, normalized: string): boolean {
  if (!normalized || normalized.length > MAX_HEADING_CHARS) return false;
  if (!/[A-Za-z]/.test(normalized)) return false;

  if (/^#{1,6}\s+\S/.test(rawLine.trim())) return true;
  if (/^\d+(\.\d+)*[.)]?\s+\S/.test(normalized)) return true;

  const endsMidSentence = /[.,;]$/.test(normalized);
  if (!endsMidSentence && normalized.length <= 60) return true;

  const letters = normalized.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 3 && letters === letters.toUpperCase()) return true;

  return false;
}

function truncateTitle(title: string): string {
  if (title.length <= MAX_HEADING_CHARS) return title;
  return `${title.slice(0, MAX_HEADING_CHARS - 1).trimEnd()}…`;
}

/**
 * Build the walk-through plan panel: one row per page, titled by the first
 * heading-like line on that page.
 *
 * Pages are returned in `pageIndex` order regardless of the order they arrive
 * in, so a caller can pass rows straight from the API without re-sorting.
 */
export function pageHeadings(pages: readonly PageLike[]): PageHeading[] {
  const sorted = [...(pages || [])].sort((a, b) => a.pageIndex - b.pageIndex);

  return sorted.map((page) => {
    const text = (page.text || '').trim();
    const charCount =
      typeof page.charCount === 'number' && page.charCount >= 0 ? page.charCount : text.length;
    const hasText = text.length >= MIN_PAGE_TEXT_CHARS && charCount > 0;
    const fallback = `Page ${page.pageIndex + 1}`;

    if (!text) {
      return { pageIndex: page.pageIndex, title: fallback, hasText: false, isDerived: false };
    }

    const rawLines = text.split(/\r?\n/).slice(0, MAX_LINES_SCANNED);
    let firstUsable = '';

    for (const rawLine of rawLines) {
      const normalized = normalizeLine(rawLine);
      if (isPageFurniture(normalized)) continue;
      if (!firstUsable) firstUsable = normalized;
      if (looksLikeHeading(rawLine, normalized)) {
        return {
          pageIndex: page.pageIndex,
          title: truncateTitle(normalized),
          hasText,
          isDerived: true,
        };
      }
    }

    if (firstUsable) {
      // No heading — label the page with its opening sentence so the plan is
      // still navigable, but say (via isDerived) that this was a guess.
      // No lookbehind: Hermes (React Native) does not support it.
      const sentenceMatch = firstUsable.match(/^[^.!?]*[.!?]/);
      const sentence = (sentenceMatch && sentenceMatch[0].trim()) || firstUsable;
      return {
        pageIndex: page.pageIndex,
        title: truncateTitle(sentence),
        hasText,
        isDerived: false,
      };
    }

    return { pageIndex: page.pageIndex, title: fallback, hasText, isDerived: false };
  });
}

/**
 * Should the walk-through offer an understanding check after this page?
 *
 * Progression stays student-driven — this only says when to OFFER a check, and
 * never gates moving on. `pageIndex` is 0-based, so with `everyN` = 3 the check
 * is offered after pages 3, 6, 9 (indexes 2, 5, 8). A non-positive or
 * non-finite `everyN` means the student turned checks off: never offer.
 */
export function walkthroughCheckpoint(pageIndex: number, everyN: number): boolean {
  if (!Number.isFinite(pageIndex) || pageIndex < 0) return false;
  if (!Number.isFinite(everyN) || everyN <= 0) return false;
  const n = Math.floor(everyN);
  if (n <= 0) return false;
  return (Math.floor(pageIndex) + 1) % n === 0;
}
