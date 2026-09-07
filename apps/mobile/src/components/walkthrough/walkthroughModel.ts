/**
 * The walk-through's rules, with no React and no I/O in them.
 *
 * The screen owns pixels, the server owns the page text, and this file owns
 * every decision between the two: which page you are on, which pages are done,
 * whether a page can be quizzed, what the companion is actually asked, and
 * what to say when the server tells us there are no pages. All of it is pure
 * so mobile jest (a node environment, `*.test.ts` only) can hold it to account
 * without rendering anything.
 *
 * The two rules that web ALSO needs — how a page is titled, and when to offer
 * a check — are not re-implemented here. They live in
 * `@lantern/shared/notes` (`pageHeadings`, `walkthroughCheckpoint`) and are
 * re-exported below, so the plan panel a student sees on the phone is derived
 * from the same code as the one in the browser. A second copy of those rules
 * is how the two platforms start disagreeing about what page 4 is called.
 */

import {
  pageHeadings,
  walkthroughCheckpoint,
  type PageHeading,
  type PageLike,
} from '@lantern/shared/notes';
/**
 * The empty-state wording moved to `@lantern/shared/notes/walkthroughCopy`
 * when the web walk-through was found printing the server's raw refusal — an
 * endpoint path and two UUIDs — at a student. Both clients now read the same
 * sentences from there; these re-exports keep this file the one door the
 * mobile screen imports from.
 */
export {
  pagesUnavailableCopy,
  shouldRetryPages,
  walkthroughUnavailableCopy,
} from '@lantern/shared/notes/walkthroughCopy';
export type {
  PagesUnavailableCopy,
  WalkthroughReason,
} from '@lantern/shared/notes/walkthroughCopy';

export { pageHeadings, walkthroughCheckpoint };
export type { PageHeading, PageLike };

/** One page as the pages route returns it. Matches `NoteAttachmentPage`. */
export interface WalkthroughPage {
  attachmentId: string;
  pageIndex: number;
  text: string;
  charCount: number;
  imageUrl?: string;
  createdAt?: string;
}

/**
 * The longest spoken question we will send.
 *
 * A question is a sentence, not a lecture: the clip is capped in the recorder
 * rather than trimmed afterwards, so a student who keeps talking is stopped
 * with the reason on screen instead of paying to transcribe a minute of it.
 */
export const MAX_VOICE_ASK_MS = 15_000;

/** The server feature key a spoken question is billed under (0 global uses). */
export const VOICE_ASK_FEATURE_KEY = 'voice_ask';

/** `/daily-quiz` refuses less than this, so the door must too — before the tap. */
export const MIN_PAGE_QUIZ_CHARS = 50;

/** Questions asked for from one page. The server may return fewer. */
export const PAGE_QUIZ_QUESTION_COUNT = 5;

/** How many pages between optional checks, when checks are on. */
export const DEFAULT_CHECK_EVERY_N = 3;

/** Where this attachment's done marks are kept. One key per note+attachment. */
export function doneStorageKey(noteId: string, attachmentId: string): string {
  return `lantern_walkthrough_done_${noteId}_${attachmentId}`;
}

/** Keep an index inside the document. An empty document is always index 0. */
export function clampPageIndex(index: number, pageCount: number): number {
  if (!Number.isFinite(index) || pageCount <= 0) return 0;
  const whole = Math.trunc(index);
  if (whole < 0) return 0;
  if (whole > pageCount - 1) return pageCount - 1;
  return whole;
}

/** The next page, or null at the end. Progression is the student's, never automatic. */
export function nextPageIndex(index: number, pageCount: number): number | null {
  const current = clampPageIndex(index, pageCount);
  return current + 1 <= pageCount - 1 ? current + 1 : null;
}

/** The previous page, or null at the start. */
export function prevPageIndex(index: number, pageCount: number): number | null {
  const current = clampPageIndex(index, pageCount);
  return current - 1 >= 0 ? current - 1 : null;
}

/**
 * Add or remove one done mark.
 *
 * Returns a NEW sorted, duplicate-free array. Sorted because the marks are
 * persisted and read back by other code (the progress line, the plan panel),
 * and an order that depends on the order of taps is a bug waiting for a
 * reader who assumes otherwise.
 */
export function toggleDone(done: readonly number[], pageIndex: number): number[] {
  if (!Number.isInteger(pageIndex) || pageIndex < 0) return [...done];
  const set = new Set(done.filter((n) => Number.isInteger(n) && n >= 0));
  if (set.has(pageIndex)) set.delete(pageIndex);
  else set.add(pageIndex);
  return [...set].sort((a, b) => a - b);
}

/** Marks read back from storage, made safe: integers, in range, no repeats. */
export function normalizeDone(raw: unknown, pageCount: number): number[] {
  if (!Array.isArray(raw)) return [];
  const set = new Set<number>();
  for (const value of raw) {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(n) || n < 0) continue;
    if (pageCount > 0 && n > pageCount - 1) continue;
    set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

/** "4 of 12 pages done". Singular when there is one page, and never "of 0". */
export function progressLabel(doneCount: number, pageCount: number): string {
  const total = Math.max(0, pageCount);
  const done = Math.min(Math.max(0, doneCount), total);
  if (total === 0) return 'No pages';
  return `${done} of ${total} ${total === 1 ? 'page' : 'pages'} done`;
}

/** The text of one page, or '' when it is blank or missing. */
export function pageText(pages: readonly WalkthroughPage[], pageIndex: number): string {
  const page = pages.find((p) => p.pageIndex === pageIndex);
  return typeof page?.text === 'string' ? page.text : '';
}

/**
 * Whether "Quiz me on this page" can run here, and why not when it cannot.
 *
 * The refusal is decided BEFORE the tap and printed on the door, because the
 * alternative is spending an AI use to be told the page was blank. The floor
 * is the server's own (`/daily-quiz` wants 50 characters), not a friendlier
 * number invented here.
 */
export function pageQuizAvailability(text: string): { canQuiz: boolean; reason?: string } {
  const trimmed = (text || '').trim();
  if (trimmed.length === 0) return { canQuiz: false, reason: 'This page has no readable text' };
  if (trimmed.length < MIN_PAGE_QUIZ_CHARS) {
    return { canQuiz: false, reason: 'Too little text on this page to make questions' };
  }
  return { canQuiz: true };
}

/**
 * How much of the page to hand the AI.
 *
 * One page is small, so this almost never bites; the cap is here so a page of
 * dumped OCR cannot quietly turn one question into a very expensive one.
 */
export const MAX_PAGE_EXCERPT_CHARS = 4000;

export function pageExcerpt(text: string, max: number = MAX_PAGE_EXCERPT_CHARS): string {
  const trimmed = (text || '').trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}

/**
 * The message the companion is asked, scoped to THIS page.
 *
 * The excerpt is the page and only the page, which is what makes the
 * companion's honesty clamp free: it is grounded in what the student is
 * looking at, so an answer that wanders off it is visibly off the page. A page
 * with no text says so instead of pretending to quote one — the clamp's
 * "general" case, made explicit rather than implied by an empty string.
 */
export function pageAskPrompt(input: {
  noteTitle: string;
  pageIndex: number;
  heading?: string;
  text: string;
  question: string;
}): string {
  const title = input.noteTitle.trim() || 'my document';
  const question = input.question.trim();
  const excerpt = pageExcerpt(input.text);
  const where = `page ${input.pageIndex + 1}${input.heading ? ` ("${input.heading}")` : ''} of "${title}"`;
  if (!excerpt) {
    return `I am reading ${where}. That page has no readable text, so answer generally and say that you could not read the page.\n\nMy question: ${question}`;
  }
  return `Explain this using only ${where}. If the answer is not on this page, say so.\n\nPage text:\n${excerpt}\n\nMy question: ${question}`;
}

/**
 * Whether to OFFER a check after marking this page done.
 *
 * Two conditions, both of them the student's: checks are on (`everyN > 0`),
 * and this index is a checkpoint. It never blocks the next page — the plan
 * calls progression student-driven, so a check is an offer and refusing one
 * costs nothing.
 */
export function shouldOfferCheck(input: {
  pageIndex: number;
  everyN: number;
  /** True only on the transition into done; re-opening a done page offers nothing. */
  justMarkedDone: boolean;
  /** Pages already offered a check, so the same one is not offered twice. */
  offered: readonly number[];
}): boolean {
  if (!input.justMarkedDone) return false;
  if (input.offered.includes(input.pageIndex)) return false;
  return walkthroughCheckpoint(input.pageIndex, input.everyN);
}

/** A spoken clip's length, said plainly: "0:08". */
export function formatClipSeconds(ms: number): string {
  const seconds = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  return `0:${String(Math.min(seconds, 99)).padStart(2, '0')}`;
}

/**
 * Whether a spoken question can be sent at all.
 *
 * `voiceAccepted` is not a guess: the Ask sheet reads the server's own feature
 * rows and looks for `voice_ask`. Until the AI lane ships that key, a spoken
 * question would be billed as a lecture transcription — so the sheet degrades
 * to the text composer and says why, rather than charging a student a lecture
 * for one sentence.
 */
export function voiceAskAvailability(input: {
  voiceAccepted: boolean;
  hasPermission: boolean;
}): { canRecord: boolean; reason?: string } {
  if (!input.voiceAccepted) {
    return { canRecord: false, reason: 'Spoken questions are not switched on yet — type yours.' };
  }
  if (!input.hasPermission) {
    return { canRecord: false, reason: 'Microphone access is off for Lantern Study.' };
  }
  return { canRecord: true };
}
