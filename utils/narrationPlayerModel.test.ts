import { describe, expect, it } from 'vitest';

import {
  DEFAULT_NARRATION_RATE,
  MAX_NARRATION_PAGES,
  NARRATION_RATES,
  clampNarrationRate,
  currentPageIndex,
  firstSegmentOfPage,
  formatNarrationPrice,
  formatSpeed,
  getNarrationCreditCost,
  highlightRangeForBoundary,
  narrationAvailability,
  narrationUnavailableMessage,
  nextPageSegment,
  nextSpeed,
  parseNarrationPosition,
  pickNarrationVoice,
  prevPageSegment,
  resumeLabel,
  resumeSegmentIndex,
  splitForHighlight,
  type NarrationVoice,
  type PlayablePageSegment,
} from './narrationPlayerModel';

/**
 * These tests cover the WEB half of the reader: what happens when the browser
 * cannot speak, which voice to use, where a remembered position resumes, and
 * how a `boundary` event becomes a highlighted word. The cursor arithmetic
 * itself belongs to `@lantern/shared/notes` and is tested there — the few
 * assertions on it below are re-export smoke tests, so a bad barrel edit is
 * caught here rather than at runtime.
 *
 * A five-segment script over three narrated pages, with page 1 carrying a
 * single line and pages 0 and 2 carrying two each.
 */
const segments: PlayablePageSegment[] = [
  { pageIndex: 0 },
  { pageIndex: 0 },
  { pageIndex: 1 },
  { pageIndex: 2 },
  { pageIndex: 2 },
];

describe('the shared cursor is re-exported, not reimplemented', () => {
  it('maps a segment to the page the viewer shows', () => {
    expect(currentPageIndex(segments, 1)).toBe(0);
    expect(currentPageIndex(segments, 4)).toBe(2);
    expect(currentPageIndex([], 3)).toBe(0);
  });

  it('lands a page skip on the start of a page, not inside it', () => {
    expect(firstSegmentOfPage(segments, 2)).toBe(3);
    expect(nextPageSegment(segments, 0)).toBe(2);
    // From the second segment of page 2, back is page 1 — not the top of this
    // page. Restarting the page is what the play control is for.
    expect(prevPageSegment(segments, 4)).toBe(2);
  });
});

describe('resume position', () => {
  it('reads a remembered position back defensively', () => {
    expect(parseNarrationPosition(null)).toEqual({ segmentIndex: 0, rate: 1 });
    expect(parseNarrationPosition('nonsense')).toEqual({ segmentIndex: 0, rate: 1 });
    expect(parseNarrationPosition({ segmentIndex: -2, rate: 99, voiceURI: '' })).toEqual({
      segmentIndex: 0,
      rate: NARRATION_RATES[NARRATION_RATES.length - 1],
      voiceURI: undefined,
    });
    expect(parseNarrationPosition({ segmentIndex: 2.7, rate: 1.25, voiceURI: 'v1' })).toEqual({
      segmentIndex: 2,
      rate: 1.25,
      voiceURI: 'v1',
    });
  });

  it('clamps a position left by a longer, older script', () => {
    expect(resumeSegmentIndex(segments, { segmentIndex: 40, rate: 1 })).toBe(0);
    expect(resumeSegmentIndex(segments, { segmentIndex: 2, rate: 1 })).toBe(2);
    expect(resumeSegmentIndex([], { segmentIndex: 3, rate: 1 })).toBe(0);
    expect(resumeSegmentIndex(segments, { segmentIndex: Number.NaN, rate: 1 })).toBe(0);
  });

  it('restarts a finished document instead of parking on its last line', () => {
    expect(resumeSegmentIndex(segments, { segmentIndex: 4, rate: 1 })).toBe(0);
  });

  it('offers to pick up only when there is somewhere to pick up', () => {
    expect(resumeLabel(segments, { segmentIndex: 0, rate: 1 })).toBeNull();
    expect(resumeLabel(segments, { segmentIndex: 4, rate: 1 })).toBeNull();
    expect(resumeLabel(segments, { segmentIndex: 3, rate: 1 })).toBe('Pick up on page 3');
  });
});

describe('speed', () => {
  it('snaps any stored rate onto the offered ladder', () => {
    expect(clampNarrationRate(0.1)).toBe(NARRATION_RATES[0]);
    expect(clampNarrationRate(9)).toBe(NARRATION_RATES[NARRATION_RATES.length - 1]);
    expect(clampNarrationRate(Number.NaN)).toBe(DEFAULT_NARRATION_RATE);
  });

  it('cycles the ladder and comes back round', () => {
    expect(nextSpeed(NARRATION_RATES[0])).toBe(NARRATION_RATES[1]);
    expect(nextSpeed(NARRATION_RATES[NARRATION_RATES.length - 1])).toBe(NARRATION_RATES[0]);
  });

  it('never gets stuck between two steps on a rate an older build stored', () => {
    // 1.1 is not on the ladder; it snaps to 1 and then advances.
    expect(nextSpeed(1.1)).toBe(1.25);
  });

  it('prints a speed a student can read', () => {
    expect(formatSpeed(1)).toBe('1×');
    expect(formatSpeed(1.25)).toBe('1.25×');
    expect(formatSpeed(50)).toBe(`${NARRATION_RATES[NARRATION_RATES.length - 1]}×`);
  });
});

describe('narrationAvailability', () => {
  it('says so honestly when the browser cannot speak, and never offers play', () => {
    const state = narrationAvailability({
      speechSupported: false,
      segments,
      scriptStatus: 'ready',
    });
    expect(state.status).toBe('unsupported');
    expect(state.canPlay).toBe(false);
    expect(state.message).toContain('cannot read aloud');
  });

  it('separates "not written yet" from "being written" from "empty"', () => {
    expect(
      narrationAvailability({ speechSupported: true, segments: [], scriptStatus: null }).status
    ).toBe('no_script');
    expect(
      narrationAvailability({ speechSupported: true, segments: [], scriptStatus: 'queued' }).status
    ).toBe('writing');
    expect(
      narrationAvailability({ speechSupported: true, segments: [], scriptStatus: 'generating' })
        .status
    ).toBe('writing');
    expect(
      narrationAvailability({ speechSupported: true, segments: [], scriptStatus: 'ready' }).status
    ).toBe('empty_script');
  });

  it("shows the server's reason for a failure, and says the use came back", () => {
    const withMessage = narrationAvailability({
      speechSupported: true,
      segments: [],
      scriptStatus: 'failed',
      errorMessage: 'The pages could not be read.',
    });
    expect(withMessage.message).toBe('The pages could not be read.');
    const generic = narrationAvailability({
      speechSupported: true,
      segments: [],
      scriptStatus: 'failed',
    });
    expect(generic.message).toContain('refunded');
  });

  it('opens the player only when there is speech AND a ready script', () => {
    expect(
      narrationAvailability({ speechSupported: true, segments, scriptStatus: 'ready' })
    ).toEqual({ status: 'ready', canPlay: true, message: null });
  });

  it('never lets a non-ready state be playable', () => {
    for (const status of ['queued', 'generating', 'failed'] as const) {
      expect(
        narrationAvailability({ speechSupported: true, segments, scriptStatus: status }).canPlay
      ).toBe(false);
    }
  });
});

describe('narrationUnavailableMessage', () => {
  it('is silent when there is a script', () => {
    expect(narrationUnavailableMessage('ok', 3)).toBeNull();
  });

  it('never calls a normal state an error', () => {
    for (const reason of ['not_generated', 'schema_missing', 'no_pages', 'failed'] as const) {
      const message = narrationUnavailableMessage(reason);
      expect(message).toBeTruthy();
      expect(message?.toLowerCase()).not.toContain('error');
    }
  });

  it('treats an "ok" with nothing in it as nothing to read', () => {
    expect(narrationUnavailableMessage('ok', 0)).toBe(
      'There is nothing in this document to read out.'
    );
  });
});

describe('pickNarrationVoice', () => {
  const voices: NarrationVoice[] = [
    { voiceURI: 'remote-en', name: 'Cloud English', lang: 'en-US', default: true },
    { voiceURI: 'local-en', name: 'Local English', lang: 'en-GB', localService: true },
    { voiceURI: 'local-fr', name: 'Local French', lang: 'fr-FR', localService: true },
  ];

  it('honours the voice the student picked last', () => {
    expect(pickNarrationVoice(voices, 'remote-en')?.voiceURI).toBe('remote-en');
  });

  it('prefers an on-device voice, because those still work offline', () => {
    expect(pickNarrationVoice(voices)?.voiceURI).toBe('local-en');
  });

  it('falls back across languages rather than returning nothing', () => {
    expect(pickNarrationVoice(voices, undefined, 'zz')?.voiceURI).toBe('local-en');
  });

  it('is null when the browser lists none — the engine picks its own', () => {
    expect(pickNarrationVoice([])).toBeNull();
  });

  it('ignores a remembered voice the browser no longer has', () => {
    expect(pickNarrationVoice(voices, 'uninstalled')?.voiceURI).toBe('local-en');
  });
});

describe('highlightRangeForBoundary', () => {
  const text = 'Mitochondria make ATP.';

  it('uses the length the engine gave when it gave one', () => {
    expect(highlightRangeForBoundary(text, 0, 12)).toEqual({ start: 0, end: 12 });
  });

  it('reads to the next space when the engine reports no length', () => {
    expect(highlightRangeForBoundary(text, 13, 0)).toEqual({ start: 13, end: 17 });
    expect(highlightRangeForBoundary(text, 18)).toEqual({ start: 18, end: 22 });
  });

  it('refuses an index outside the text, so a late event cannot bleed', () => {
    expect(highlightRangeForBoundary(text, 500, 4)).toBeNull();
    expect(highlightRangeForBoundary(text, -1)).toBeNull();
    expect(highlightRangeForBoundary('', 0)).toBeNull();
  });

  it('never runs the highlight past the end of the text', () => {
    expect(highlightRangeForBoundary(text, 18, 999)).toEqual({ start: 18, end: text.length });
  });
});

describe('splitForHighlight', () => {
  it('splits into before/word/after', () => {
    expect(splitForHighlight('one two three', { start: 4, end: 7 })).toEqual({
      before: 'one ',
      word: 'two',
      after: ' three',
    });
  });

  it('renders the whole segment plainly when nothing is highlighted', () => {
    expect(splitForHighlight('one two', null)).toEqual({ before: 'one two', word: '', after: '' });
  });
});

describe('pricing comes from the shared table', () => {
  it('is the same number the server charges', () => {
    expect(formatNarrationPrice(12)).toContain(String(getNarrationCreditCost(12)));
    expect(formatNarrationPrice(30)).toContain(String(getNarrationCreditCost(30)));
  });

  it('says AI uses, never credits or tokens', () => {
    expect(formatNarrationPrice(MAX_NARRATION_PAGES)).toContain('AI uses');
    expect(formatNarrationPrice(MAX_NARRATION_PAGES)).not.toContain('credit');
  });
});
