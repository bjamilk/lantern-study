/**
 * The walk-through's rules, tested where they are decided.
 *
 * Nothing here renders. Every case below is a decision a student can feel —
 * a door that should be shut, a mark that should survive a bad read from
 * storage, a question that should be scoped to the page in front of them.
 */

import {
  clampPageIndex,
  DEFAULT_CHECK_EVERY_N,
  doneStorageKey,
  formatClipSeconds,
  MAX_PAGE_EXCERPT_CHARS,
  MIN_PAGE_QUIZ_CHARS,
  nextPageIndex,
  normalizeDone,
  pageAskPrompt,
  pageExcerpt,
  pageQuizAvailability,
  pageText,
  prevPageIndex,
  progressLabel,
  shouldOfferCheck,
  toggleDone,
  voiceAskAvailability,
  pagesUnavailableCopy,
  walkthroughUnavailableCopy,
  type WalkthroughPage,
} from './walkthroughModel';
import { REQUEST_FAILURE_COPY } from '@lantern/shared/network';

const page = (pageIndex: number, text: string): WalkthroughPage => ({
  attachmentId: 'att-1',
  pageIndex,
  text,
  charCount: text.length,
});

describe('paging', () => {
  it('keeps an index inside the document', () => {
    expect(clampPageIndex(-4, 10)).toBe(0);
    expect(clampPageIndex(99, 10)).toBe(9);
    expect(clampPageIndex(3, 10)).toBe(3);
  });

  it('treats a document with no pages as index 0', () => {
    expect(clampPageIndex(5, 0)).toBe(0);
  });

  it('survives nonsense rather than paging to NaN', () => {
    expect(clampPageIndex(Number.NaN, 10)).toBe(0);
    expect(clampPageIndex(2.7, 10)).toBe(2);
  });

  it('stops at both ends instead of wrapping', () => {
    expect(nextPageIndex(8, 10)).toBe(9);
    expect(nextPageIndex(9, 10)).toBeNull();
    expect(prevPageIndex(1, 10)).toBe(0);
    expect(prevPageIndex(0, 10)).toBeNull();
  });
});

describe('done marks', () => {
  it('adds and removes, and returns a sorted set', () => {
    expect(toggleDone([2, 0], 1)).toEqual([0, 1, 2]);
    expect(toggleDone([0, 1, 2], 1)).toEqual([0, 2]);
  });

  it('never lets one page be done twice', () => {
    expect(toggleDone([1, 1, 1], 2)).toEqual([1, 2]);
  });

  it('ignores a mark that is not a page', () => {
    expect(toggleDone([0], -1)).toEqual([0]);
    expect(toggleDone([0], 1.5)).toEqual([0]);
  });

  it('drops out-of-range and junk marks read back from storage', () => {
    expect(normalizeDone([0, 3, 3, '2', -1, 99, null], 5)).toEqual([0, 2, 3]);
  });

  it('reads a corrupt value as no marks rather than throwing', () => {
    expect(normalizeDone('{"a":1}', 5)).toEqual([]);
    expect(normalizeDone(undefined, 5)).toEqual([]);
  });

  it('keys storage per note AND per attachment', () => {
    expect(doneStorageKey('n1', 'a1')).not.toEqual(doneStorageKey('n1', 'a2'));
    expect(doneStorageKey('n1', 'a1')).not.toEqual(doneStorageKey('n2', 'a1'));
  });

  it('counts honestly, and never says "of 0"', () => {
    expect(progressLabel(4, 12)).toBe('4 of 12 pages done');
    expect(progressLabel(1, 1)).toBe('1 of 1 page done');
    expect(progressLabel(3, 0)).toBe('No pages');
    expect(progressLabel(99, 4)).toBe('4 of 4 pages done');
  });
});

describe('quiz me on this page', () => {
  it('is open on a page with enough text', () => {
    expect(pageQuizAvailability('x'.repeat(MIN_PAGE_QUIZ_CHARS)).canQuiz).toBe(true);
  });

  it('is shut, with the reason, on a blank page', () => {
    const verdict = pageQuizAvailability('   ');
    expect(verdict.canQuiz).toBe(false);
    expect(verdict.reason).toMatch(/no readable text/i);
  });

  it('is shut on a page the server would refuse anyway', () => {
    const verdict = pageQuizAvailability('Too short.');
    expect(verdict.canQuiz).toBe(false);
    expect(verdict.reason).toMatch(/too little text/i);
  });
});

describe('the page excerpt', () => {
  it('reads the page the student is on, not the one next to it', () => {
    const pages = [page(0, 'first'), page(1, 'second')];
    expect(pageText(pages, 1)).toBe('second');
  });

  it('is empty for a blank or missing page — the honesty clamp’s "general" case', () => {
    expect(pageText([page(0, '')], 0)).toBe('');
    expect(pageText([page(0, 'a')], 4)).toBe('');
  });

  it('caps a page of dumped OCR', () => {
    expect(pageExcerpt('x'.repeat(MAX_PAGE_EXCERPT_CHARS + 500)).length).toBe(
      MAX_PAGE_EXCERPT_CHARS
    );
  });
});

describe('the question the companion is asked', () => {
  it('names the page and carries only that page’s text', () => {
    const prompt = pageAskPrompt({
      noteTitle: 'Renal physiology',
      pageIndex: 3,
      heading: 'Loop of Henle',
      text: 'The descending limb is permeable to water.',
      question: 'Why is the descending limb permeable?',
    });
    expect(prompt).toContain('page 4');
    expect(prompt).toContain('Loop of Henle');
    expect(prompt).toContain('The descending limb is permeable to water.');
    expect(prompt).toContain('Why is the descending limb permeable?');
  });

  it('tells the model to say so when the answer is not on the page', () => {
    const prompt = pageAskPrompt({
      noteTitle: 'Renal physiology',
      pageIndex: 0,
      text: 'Some page text that is long enough to matter.',
      question: 'What about the heart?',
    });
    expect(prompt).toMatch(/not on this page, say so/i);
  });

  it('does not pretend to quote a blank page', () => {
    const prompt = pageAskPrompt({
      noteTitle: 'Slides',
      pageIndex: 5,
      text: '   ',
      question: 'What is this diagram?',
    });
    expect(prompt).toMatch(/no readable text/i);
    expect(prompt).toContain('page 6');
  });
});

describe('the optional check', () => {
  it('is offered after every N pages, and only on the mark', () => {
    expect(
      shouldOfferCheck({ pageIndex: 2, everyN: DEFAULT_CHECK_EVERY_N, justMarkedDone: true, offered: [] })
    ).toBe(true);
    expect(
      shouldOfferCheck({ pageIndex: 1, everyN: DEFAULT_CHECK_EVERY_N, justMarkedDone: true, offered: [] })
    ).toBe(false);
  });

  it('is not offered by merely re-opening a page that is already done', () => {
    expect(
      shouldOfferCheck({ pageIndex: 2, everyN: 3, justMarkedDone: false, offered: [] })
    ).toBe(false);
  });

  it('is never offered twice for the same page', () => {
    expect(
      shouldOfferCheck({ pageIndex: 2, everyN: 3, justMarkedDone: true, offered: [2] })
    ).toBe(false);
  });

  it('is off entirely when the student turns checks off', () => {
    expect(
      shouldOfferCheck({ pageIndex: 2, everyN: 0, justMarkedDone: true, offered: [] })
    ).toBe(false);
  });
});

describe('what to say when there is nothing to walk through', () => {
  it('calls an unapplied migration a state, not an error', () => {
    const copy = walkthroughUnavailableCopy('schema_missing');
    expect(copy.detail).toMatch(/not been split into pages/i);
    expect(copy.retryable).toBe(false);
  });

  it('offers another look only where one could help', () => {
    expect(walkthroughUnavailableCopy('preview_pending').retryable).toBe(true);
    expect(walkthroughUnavailableCopy('source_missing').retryable).toBe(false);
    expect(walkthroughUnavailableCopy('unreadable').retryable).toBe(false);
    expect(walkthroughUnavailableCopy('unsupported').retryable).toBe(false);
  });

  it('gives every reason a title and a detail, so no case renders empty', () => {
    for (const reason of [
      'ok',
      'schema_missing',
      'unsupported',
      'source_missing',
      'preview_pending',
      'unreadable',
    ] as const) {
      const copy = walkthroughUnavailableCopy(reason);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.detail.length).toBeGreaterThan(0);
    }
  });
});

describe('the spoken question', () => {
  it('is refused until the server accepts the voice_ask key', () => {
    const verdict = voiceAskAvailability({ voiceAccepted: false, hasPermission: true });
    expect(verdict.canRecord).toBe(false);
    expect(verdict.reason).toMatch(/type yours/i);
  });

  it('is refused, with the real reason, when the mic is off', () => {
    const verdict = voiceAskAvailability({ voiceAccepted: true, hasPermission: false });
    expect(verdict.canRecord).toBe(false);
    expect(verdict.reason).toMatch(/microphone/i);
  });

  it('is allowed once both are true', () => {
    expect(voiceAskAvailability({ voiceAccepted: true, hasPermission: true }).canRecord).toBe(true);
  });

  it('reads a clip length back plainly', () => {
    expect(formatClipSeconds(0)).toBe('0:00');
    expect(formatClipSeconds(8400)).toBe('0:08');
    expect(formatClipSeconds(Number.NaN)).toBe('0:00');
  });
});

describe('pagesUnavailableCopy', () => {
  /** What the mobile notes client throws for a non-2xx: message, status, body. */
  const requestError = (message: string, status: number, body?: unknown) =>
    Object.assign(new Error(message), { status, body });

  it('never lets the server’s own sentence reach the student', () => {
    const raw =
      'Not found - /api/v1/notes/6f2d0c1e-0000-4a11-9f00-2b7a1c3d4e5f/attachments/1a2b3c4d-0000-4c22-8e00-9f8e7d6c5b4a/pages?images=1';
    const copy = pagesUnavailableCopy(requestError(raw, 404));
    expect(copy.detail).not.toContain('/api/');
    expect(copy.detail).not.toContain('6f2d0c1e');
    expect(copy.title).not.toContain('/api/');
    expect(copy.detail).toBe('This document has not been split into pages on the server yet.');
  });

  it('offers no retry when the route itself is absent (404)', () => {
    const copy = pagesUnavailableCopy(requestError('Not found', 404));
    expect(copy.retryable).toBe(false);
    expect(copy.retryLabel).toBeNull();
  });

  it('reads a RequestError NOT_FOUND code with no status the same way', () => {
    const copy = pagesUnavailableCopy(
      Object.assign(new Error('Request failed'), { code: 'NOT_FOUND' })
    );
    expect(copy.detail).toMatch(/not been split into pages/i);
    expect(copy.retryable).toBe(false);
  });

  it('says the same thing for the schema_missing payload as for the missing route', () => {
    expect(pagesUnavailableCopy({ available: false, reason: 'schema_missing' }).detail).toBe(
      pagesUnavailableCopy(requestError('Not found', 404)).detail
    );
  });

  it('offers a retry while a deck is still converting', () => {
    const copy = pagesUnavailableCopy({ available: false, reason: 'preview_pending' });
    expect(copy.detail).toBe('Still converting this deck — try again in a minute.');
    expect(copy.retryable).toBe(true);
    expect(copy.retryLabel).toBeTruthy();
  });

  it('names what has pages at all when the file is the wrong kind', () => {
    const copy = pagesUnavailableCopy({ available: false, reason: 'unsupported' });
    expect(copy.detail).toBe('Only PDFs and slide decks have pages.');
    expect(copy.retryable).toBe(false);
  });

  it('gives a missing and an unreadable file the same honest sentence, with no retry', () => {
    for (const reason of ['source_missing', 'unreadable'] as const) {
      const copy = pagesUnavailableCopy({ available: false, reason });
      expect(copy.detail).toBe('We could not read this document.');
      expect(copy.retryable).toBe(false);
      expect(copy.retryLabel).toBeNull();
    }
  });

  it('uses the app’s standard offline line, with a retry, for a network failure', () => {
    const copy = pagesUnavailableCopy(new Error('Network request failed'));
    expect(copy.title).toBe(REQUEST_FAILURE_COPY.offline.title);
    expect(copy.detail).toBe(REQUEST_FAILURE_COPY.offline.body);
    expect(copy.retryable).toBe(true);
  });

  it('falls back to one generic sentence for anything else, never the raw one', () => {
    const copy = pagesUnavailableCopy(requestError('column pages.text does not exist', 500));
    expect(copy.detail).toBe('Something went wrong loading the pages.');
    expect(copy.detail).not.toContain('column');
    expect(copy.retryable).toBe(true);
  });

  it('reads a reason the server tucked inside an error body', () => {
    const copy = pagesUnavailableCopy(
      requestError('Bad request', 400, { reason: 'preview_pending' })
    );
    expect(copy.retryable).toBe(true);
    expect(copy.detail).toMatch(/still converting/i);
  });

  it('treats an ok payload with nothing in it as the plain empty document', () => {
    expect(pagesUnavailableCopy({ available: true, reason: 'ok' }).detail).toBe(
      walkthroughUnavailableCopy('ok').detail
    );
    expect(pagesUnavailableCopy(null).retryable).toBe(false);
  });

  it('ignores a reason the client does not know', () => {
    const copy = pagesUnavailableCopy({ available: false, reason: 'quantum_flux' });
    expect(copy.detail).toBe('Something went wrong loading the pages.');
  });
});
