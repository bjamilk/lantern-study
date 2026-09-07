import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CHECK_EVERY_N_PAGES,
  WALKTHROUGH_GROUNDING_LABELS,
  buildPageQuestion,
  checkpointDue,
  checkpointPageIndexes,
  clampPageIndex,
  nextUndonePageIndex,
  pageExcerpt,
  pageGrounding,
  pageHeadings,
  pagesUnavailableMessage,
  shouldRetryPages,
  stepPageIndex,
  walkthroughProgress,
} from './walkthroughModel';

const PAGES = [
  { pageIndex: 0, text: '# Enzyme kinetics\nEnzymes lower activation energy.', charCount: 52 },
  { pageIndex: 1, text: '', charCount: 0 },
  { pageIndex: 2, text: 'Michaelis-Menten\nThe curve saturates at Vmax.', charCount: 45 },
  { pageIndex: 3, text: 'Inhibition\nCompetitive inhibitors raise Km.', charCount: 44 },
];

const HEADINGS = pageHeadings(PAGES);

describe('page paging', () => {
  it('clamps a remembered index onto a document that shrank', () => {
    expect(clampPageIndex(4, 9)).toBe(3);
    expect(clampPageIndex(4, -2)).toBe(0);
    // No pages at all must not produce -1, which would index nothing.
    expect(clampPageIndex(0, 3)).toBe(0);
    expect(clampPageIndex(4, Number.NaN)).toBe(0);
  });

  it('stops at the ends instead of wrapping', () => {
    expect(stepPageIndex(4, 0, -1)).toBe(0);
    expect(stepPageIndex(4, 3, 1)).toBe(3);
    expect(stepPageIndex(4, 1, 1)).toBe(2);
  });
});

describe('page excerpt and grounding', () => {
  it('returns the page text and caps it', () => {
    expect(pageExcerpt(PAGES, 2)).toContain('Michaelis-Menten');
    expect(pageExcerpt(PAGES, 0, 10)).toBe('# Enzyme k…');
  });

  it('returns nothing for a blank page or a page that does not exist', () => {
    expect(pageExcerpt(PAGES, 1)).toBe('');
    expect(pageExcerpt(PAGES, 99)).toBe('');
  });

  it('flips the badge to general on a blank page', () => {
    expect(pageGrounding(HEADINGS, 0)).toBe('page');
    expect(pageGrounding(HEADINGS, 1)).toBe('general');
    expect(WALKTHROUGH_GROUNDING_LABELS.general).toMatch(/no readable text/i);
  });

  it('never claims the page when the question travels without an excerpt', () => {
    const grounded = buildPageQuestion({ question: 'Why?', pageIndex: 2, excerpt: pageExcerpt(PAGES, 2) });
    expect(grounded).toContain('Michaelis-Menten');
    expect(grounded).toContain('page 3');

    const blank = buildPageQuestion({ question: 'Why?', pageIndex: 1, excerpt: pageExcerpt(PAGES, 1) });
    expect(blank).toContain('general knowledge');
    expect(blank).not.toContain('"""');
  });
});

describe('progress', () => {
  it('counts only pages the document still has', () => {
    const done = new Set([0, 2, 42]);
    const progress = walkthroughProgress(HEADINGS, done);
    expect(progress.total).toBe(4);
    expect(progress.doneCount).toBe(2);
    expect(progress.percent).toBe(50);
    expect(progress.allDone).toBe(false);
  });

  it('reports 0% rather than NaN for a document with no pages', () => {
    expect(walkthroughProgress([], new Set()).percent).toBe(0);
    expect(walkthroughProgress([], new Set()).allDone).toBe(false);
  });

  it('finds the next undone page, wrapping back to earlier gaps', () => {
    expect(nextUndonePageIndex(HEADINGS, new Set([0]), 0)).toBe(1);
    // Everything after page 2 is done, so the unread page 1 is the answer.
    expect(nextUndonePageIndex(HEADINGS, new Set([0, 2, 3]), 2)).toBe(1);
    expect(nextUndonePageIndex(HEADINGS, new Set([0, 1, 2, 3]), 0)).toBeNull();
  });
});

describe('checkpoints', () => {
  const everyN = DEFAULT_CHECK_EVERY_N_PAGES;

  it('offers a check only after the block is read', () => {
    expect(checkpointDue({ headings: HEADINGS, pageIndex: 2, everyN, done: new Set([0, 1, 2]) })).toBe(true);
    // Not read yet — a check here is an interruption, not a check.
    expect(checkpointDue({ headings: HEADINGS, pageIndex: 2, everyN, done: new Set([0, 1]) })).toBe(false);
    // Mid-block.
    expect(checkpointDue({ headings: HEADINGS, pageIndex: 1, everyN, done: new Set([0, 1]) })).toBe(false);
  });

  it('never offers when checks are turned off', () => {
    expect(checkpointDue({ headings: HEADINGS, pageIndex: 2, everyN: 0, done: new Set([0, 1, 2]) })).toBe(false);
  });

  it('does not re-offer a check that was already handled', () => {
    expect(
      checkpointDue({
        headings: HEADINGS,
        pageIndex: 2,
        everyN,
        done: new Set([0, 1, 2]),
        satisfied: new Set([2]),
      })
    ).toBe(false);
  });

  it('covers the block but skips pages with nothing to ask about', () => {
    // Pages 0-2, minus the blank page 1.
    expect(checkpointPageIndexes(HEADINGS, 2, everyN)).toEqual([0, 2]);
  });

  it('does not offer a check over a block that is entirely blank', () => {
    const blank = pageHeadings([
      { pageIndex: 0, text: '', charCount: 0 },
      { pageIndex: 1, text: '', charCount: 0 },
      { pageIndex: 2, text: '', charCount: 0 },
    ]);
    expect(checkpointDue({ headings: blank, pageIndex: 2, everyN, done: new Set([0, 1, 2]) })).toBe(false);
  });
});

describe('unavailable pages', () => {
  it('says nothing when pages are there', () => {
    expect(pagesUnavailableMessage('ok', 4)).toBeNull();
  });

  it('explains each honest not-available state without calling it an error', () => {
    for (const reason of ['schema_missing', 'unsupported', 'source_missing', 'unreadable', 'preview_pending'] as const) {
      const message = pagesUnavailableMessage(reason);
      expect(message, reason).toBeTruthy();
      expect(message!.toLowerCase(), reason).not.toContain('error');
    }
    expect(pagesUnavailableMessage('ok', 0)).toBeTruthy();
  });

  it('retries only the state that resolves on its own', () => {
    expect(shouldRetryPages('preview_pending')).toBe(true);
    expect(shouldRetryPages('source_missing')).toBe(false);
    expect(shouldRetryPages('schema_missing')).toBe(false);
  });
});
