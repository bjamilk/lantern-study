/**
 * Walk-through model — the arithmetic behind "walk me through this document".
 *
 * Everything here is pure so the screen can stay a rendering problem: which
 * page is showing, which pages the student has marked done, where the next
 * unread page is, and whether this is a sensible moment to OFFER a check.
 *
 * Two rules are load-bearing and are enforced here rather than in the view:
 *
 *   1. Progression is student-driven. Nothing in this file blocks moving to
 *      the next page — `checkpointDue` says when to *offer* a check, never
 *      when to gate one.
 *   2. A page with no readable text cannot be explained or quizzed, and the
 *      screen must say so instead of implying the tutor is reading it. That
 *      judgement comes from the shared `pageHeadings` (`hasText`), so web,
 *      mobile and the server all draw the line in the same place.
 */
import {
  pageHeadings,
  walkthroughCheckpoint,
  type PageHeading,
  type PageLike,
} from '@lantern/shared/notes';

export { pageHeadings, walkthroughCheckpoint };
export type { PageHeading, PageLike };

/**
 * The empty-state wording is NOT written here.
 *
 * It lives in `@lantern/shared/notes/walkthroughCopy`, which mobile reads too.
 * This file used to carry its own `pagesUnavailableMessage`, and the two
 * clients had already drifted — web still told students "This deck is still
 * being converted…" for a reason mobile phrased differently, and web had no
 * answer at all for a server that refuses the route, so it printed the
 * refusal: an endpoint path and two UUIDs, in red, under a Try again button
 * that could never work. One module, one set of sentences, one honest
 * `retryable`.
 */
export {
  pagesUnavailableCopy,
  shouldRetryPages,
  walkthroughUnavailableCopy,
} from '@lantern/shared/notes/walkthroughCopy';
export type {
  PagesUnavailableCopy,
  WalkthroughReason as WalkthroughPagesReason,
} from '@lantern/shared/notes/walkthroughCopy';

/** Where an answer about the current page can honestly come from. */
export type WalkthroughGrounding = 'page' | 'general';

/**
 * What the badge says.
 *
 * The wording is a claim about what was SENT, not about what the model chose
 * to use — the server may still reach the rest of the note through its own
 * retrieval, so "answered from this page" would be a promise this screen
 * cannot keep. `general` is not a failure: it is the honest reading of a page
 * the tutor cannot see, and it must never be dressed up as an answer from the
 * student's document.
 */
export const WALKTHROUGH_GROUNDING_LABELS: Record<WalkthroughGrounding, string> = {
  page: 'This page is sent with your question',
  general: 'This page has no readable text — answered from general knowledge',
};

/** How much of a page travels with a question. Whole pages are far smaller. */
export const MAX_PAGE_EXCERPT_CHARS = 4000;

/** Default spacing for the optional understanding check. 0 turns checks off. */
export const DEFAULT_CHECK_EVERY_N_PAGES = 3;

/**
 * `/generate-questions` refuses less than this, so the screen must too.
 *
 * The refusal comes back as a 400 whose body is a server sentence, and a
 * server sentence is exactly what this round is removing from the screen. The
 * honest fix is not to prettify the refusal but to not earn it: a block of
 * pages with almost no text cannot be quizzed, and the button says so before
 * it is pressed. Matches mobile's MIN_PAGE_QUIZ_CHARS.
 */
export const MIN_PAGE_QUIZ_CHARS = 50;

/** A set of 0-based page indexes the student has marked done. */
export type DonePages = ReadonlySet<number>;

/**
 * Clamp a requested page index onto the pages we actually have.
 *
 * Pages are contiguous and 0-based, but they arrive from the network and a
 * remembered index can outlive the document it was remembered for (a re-upload
 * with fewer pages). Returning 0 for an empty document keeps callers from
 * having to special-case "no pages yet".
 */
export function clampPageIndex(pageCount: number, requested: number): number {
  if (!Number.isFinite(pageCount) || pageCount <= 0) return 0;
  if (!Number.isFinite(requested)) return 0;
  const floored = Math.floor(requested);
  if (floored < 0) return 0;
  const last = Math.floor(pageCount) - 1;
  return floored > last ? last : floored;
}

/** Move `delta` pages, stopping at the ends rather than wrapping. */
export function stepPageIndex(pageCount: number, current: number, delta: number): number {
  const from = clampPageIndex(pageCount, current);
  if (!Number.isFinite(delta)) return from;
  return clampPageIndex(pageCount, from + Math.trunc(delta));
}

/**
 * The text of one page, capped.
 *
 * This is the excerpt the tutor is given for "ask about this page", so an
 * empty string here is exactly the blank-page case: no excerpt goes out, and
 * the grounding badge says general.
 */
export function pageExcerpt(
  pages: ReadonlyArray<PageLike>,
  pageIndex: number,
  maxChars: number = MAX_PAGE_EXCERPT_CHARS
): string {
  const page = (pages || []).find((p) => p && p.pageIndex === pageIndex);
  const text = (page?.text || '').trim();
  if (!text) return '';
  const limit = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : MAX_PAGE_EXCERPT_CHARS;
  return text.length <= limit ? text : `${text.slice(0, limit).trimEnd()}…`;
}

/**
 * Can this page be explained or quizzed at all?
 *
 * Delegated to the shared heading pass so "there is nothing here" means the
 * same thing in the plan panel, in the quiz button's disabled state and in the
 * grounding badge.
 */
export function pageHasText(headings: ReadonlyArray<PageHeading>, pageIndex: number): boolean {
  return Boolean(headings.find((h) => h.pageIndex === pageIndex)?.hasText);
}

/** The badge state for a page: `page` only when that page carries text. */
export function pageGrounding(
  headings: ReadonlyArray<PageHeading>,
  pageIndex: number
): WalkthroughGrounding {
  return pageHasText(headings, pageIndex) ? 'page' : 'general';
}

/**
 * The next page the student has not marked done, searching forward from
 * `from` and then wrapping to the start, so "next unread" still works after
 * they have jumped back to re-read something.
 *
 * Returns null only when every page is done.
 */
export function nextUndonePageIndex(
  headings: ReadonlyArray<PageHeading>,
  done: DonePages,
  from = 0
): number | null {
  const ordered = [...headings].sort((a, b) => a.pageIndex - b.pageIndex);
  if (ordered.length === 0) return null;
  const start = Number.isFinite(from) ? Math.floor(from) : 0;
  const after = ordered.find((h) => h.pageIndex > start && !done.has(h.pageIndex));
  if (after) return after.pageIndex;
  const wrapped = ordered.find((h) => !done.has(h.pageIndex));
  return wrapped ? wrapped.pageIndex : null;
}

export interface WalkthroughProgress {
  total: number;
  doneCount: number;
  /** 0-100, rounded. 0 for an empty document rather than NaN. */
  percent: number;
  allDone: boolean;
}

/**
 * Progress counts only pages that exist. A remembered done-mark for a page the
 * document no longer has must not push the bar past 100%.
 */
export function walkthroughProgress(
  headings: ReadonlyArray<PageHeading>,
  done: DonePages
): WalkthroughProgress {
  const total = headings.length;
  const doneCount = headings.filter((h) => done.has(h.pageIndex)).length;
  return {
    total,
    doneCount,
    percent: total > 0 ? Math.round((doneCount / total) * 100) : 0,
    allDone: total > 0 && doneCount === total,
  };
}

/**
 * The pages one check covers: the block of `everyN` pages ending at
 * `pageIndex`, minus any that carry no text (nothing to ask about).
 */
export function checkpointPageIndexes(
  headings: ReadonlyArray<PageHeading>,
  pageIndex: number,
  everyN: number
): number[] {
  if (!Number.isFinite(pageIndex) || pageIndex < 0) return [];
  if (!Number.isFinite(everyN) || everyN <= 0) return [];
  const n = Math.floor(everyN);
  if (n <= 0) return [];
  const first = Math.max(0, Math.floor(pageIndex) - n + 1);
  return headings
    .filter((h) => h.pageIndex >= first && h.pageIndex <= Math.floor(pageIndex) && h.hasText)
    .map((h) => h.pageIndex)
    .sort((a, b) => a - b);
}

export interface CheckpointInput {
  headings: ReadonlyArray<PageHeading>;
  pageIndex: number;
  everyN: number;
  done: DonePages;
  /** Checks already offered/answered, so one is not re-offered on every render. */
  satisfied?: DonePages;
}

/**
 * Should the screen offer an understanding check right now?
 *
 * Four conditions, all of them "offer", none of them "gate":
 *   - the shared pacing rule says this index ends a block (`walkthroughCheckpoint`);
 *   - the student has actually marked this page done — a check before they read
 *     the page is just an interruption;
 *   - the block contains at least one page with text to ask about;
 *   - the check for this index has not already been offered.
 */
export function checkpointDue({
  headings,
  pageIndex,
  everyN,
  done,
  satisfied,
}: CheckpointInput): boolean {
  if (!walkthroughCheckpoint(pageIndex, everyN)) return false;
  if (!done.has(Math.floor(pageIndex))) return false;
  if (satisfied?.has(Math.floor(pageIndex))) return false;
  return checkpointPageIndexes(headings, pageIndex, everyN).length > 0;
}

/**
 * Compose the message that goes to the companion for "ask about this page".
 *
 * The page's own text is quoted into the message because that is the only way
 * this page — rather than whatever the whole-note retrieval happens to match —
 * reaches the tutor. When the page carries no text nothing is quoted and the
 * question travels alone, which is what makes the general badge true.
 */
export function buildPageQuestion(input: {
  question: string;
  pageIndex: number;
  excerpt: string;
  documentLabel?: string;
}): string {
  const question = input.question.trim();
  const where = input.documentLabel?.trim()
    ? `page ${input.pageIndex + 1} of ${input.documentLabel.trim()}`
    : `page ${input.pageIndex + 1}`;
  if (!input.excerpt.trim()) {
    return `${question}\n\n(I am on ${where}, which has no readable text — answer from general knowledge.)`;
  }
  return `${question}\n\nI am on ${where}. Here is that page:\n"""\n${input.excerpt.trim()}\n"""`;
}
