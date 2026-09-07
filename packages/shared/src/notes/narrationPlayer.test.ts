import {
  DEFAULT_NARRATION_RATE,
  clampNarrationRate,
  currentPageIndex,
  firstSegmentOfPage,
  initialNarrationState,
  narrationPositionLabel,
  narrationReducer,
  nextPageSegment,
  prevPageSegment,
  type NarrationPlayerState,
} from './narrationPlayer';

/**
 * Shaped like the server's script rows, with the extra fields left in on
 * purpose: the cursor takes anything carrying a `pageIndex`, and the test
 * proves it rather than asserting it in a comment.
 */
const seg = (pageIndex: number, order: number, text = 'words') => ({
  pageIndex,
  order,
  text,
  estimatedSeconds: 4,
});

/** Page 0 is split in two; pages 1 and 2 are one segment each. */
const script = [seg(0, 0), seg(0, 1), seg(1, 2), seg(2, 3)];

/** A document whose first two pages were blank, so nothing narrated them. */
const gappy = [seg(2, 0), seg(5, 1), seg(6, 2)];

const playing = (index: number): NarrationPlayerState => ({
  status: 'playing',
  index,
  rate: DEFAULT_NARRATION_RATE,
});

describe('narrationReducer', () => {
  it('advances only on segmentDone, and ends instead of looping', () => {
    expect(narrationReducer(playing(0), { type: 'segmentDone' }, 4)).toMatchObject({
      status: 'playing',
      index: 1,
    });
    expect(narrationReducer(playing(3), { type: 'segmentDone' }, 4)).toMatchObject({
      status: 'ended',
      index: 3,
    });
  });

  it('ignores segmentDone while paused — a cancelled utterance cannot advance a paused deck', () => {
    const paused: NarrationPlayerState = { status: 'paused', index: 1, rate: 1 };
    expect(narrationReducer(paused, { type: 'segmentDone' }, 4)).toEqual(paused);
  });

  it('keeps a paused deck paused when the student skips', () => {
    const paused: NarrationPlayerState = { status: 'paused', index: 1, rate: 1 };
    expect(narrationReducer(paused, { type: 'next' }, 4)).toMatchObject({
      status: 'paused',
      index: 2,
    });
    expect(narrationReducer(paused, { type: 'prev' }, 4)).toMatchObject({
      status: 'paused',
      index: 0,
    });
  });

  it('restarts from the top when play is pressed on a finished deck', () => {
    const ended: NarrationPlayerState = { status: 'ended', index: 3, rate: 1 };
    expect(narrationReducer(ended, { type: 'play' }, 4)).toMatchObject({
      status: 'playing',
      index: 0,
    });
  });

  it('re-opens the last segment when back is pressed at the end', () => {
    const ended: NarrationPlayerState = { status: 'ended', index: 3, rate: 1 };
    expect(narrationReducer(ended, { type: 'prev' }, 4)).toMatchObject({
      status: 'paused',
      index: 3,
    });
  });

  it('toggles both ways', () => {
    expect(narrationReducer(playing(1), { type: 'toggle' }, 4).status).toBe('paused');
    const paused: NarrationPlayerState = { status: 'paused', index: 1, rate: 1 };
    expect(narrationReducer(paused, { type: 'toggle' }, 4).status).toBe('playing');
  });

  it('clamps a seek and never moves the cursor on a rate change', () => {
    expect(narrationReducer(playing(1), { type: 'seek', index: 99 }, 4).index).toBe(3);
    expect(narrationReducer(playing(1), { type: 'seek', index: -4 }, 4).index).toBe(0);
    expect(narrationReducer(playing(2), { type: 'setRate', rate: 1.5 }, 4)).toMatchObject({
      status: 'playing',
      index: 2,
      rate: 1.5,
    });
  });

  it('collapses to idle over an empty script rather than claiming to play', () => {
    expect(narrationReducer(initialNarrationState(), { type: 'play' }, 0)).toMatchObject({
      status: 'idle',
      index: 0,
    });
  });

  it('stops on the paragraph the engine refused, with a reason, and never advances', () => {
    const errored = narrationReducer(playing(1), { type: 'speechError' }, 4);
    expect(errored).toMatchObject({ status: 'error', index: 1 });
    expect(errored.errorReason).toBeTruthy();

    const withReason = narrationReducer(
      playing(1),
      { type: 'speechError', reason: 'No voice for this language.' },
      4
    );
    expect(withReason.errorReason).toBe('No voice for this language.');
  });

  it('does not loop when the engine fails the same paragraph twice', () => {
    const once = narrationReducer(playing(2), { type: 'speechError', reason: 'nope' }, 4);
    const twice = narrationReducer(once, { type: 'speechError', reason: 'nope again' }, 4);
    // Same segment, same state: a second failure is not a second event.
    expect(twice).toEqual(once);
    expect(twice.index).toBe(2);
  });

  it('ignores a stale error from an utterance that was already cancelled', () => {
    const paused: NarrationPlayerState = { status: 'paused', index: 1, rate: 1 };
    expect(narrationReducer(paused, { type: 'speechError' }, 4)).toEqual(paused);
    const ended: NarrationPlayerState = { status: 'ended', index: 3, rate: 1 };
    expect(narrationReducer(ended, { type: 'speechError' }, 4)).toEqual(ended);
  });

  it('retries the SAME paragraph when play is pressed on an error', () => {
    const errored = narrationReducer(playing(2), { type: 'speechError' }, 4);
    const retried = narrationReducer(errored, { type: 'play' }, 4);
    expect(retried).toEqual({ status: 'playing', index: 2, rate: DEFAULT_NARRATION_RATE });
    expect(narrationReducer(errored, { type: 'toggle' }, 4).status).toBe('playing');
  });

  it('lets the student skip past a paragraph the engine will not read, silently', () => {
    const errored = narrationReducer(playing(1), { type: 'speechError' }, 4);
    expect(narrationReducer(errored, { type: 'next' }, 4)).toEqual({
      status: 'paused',
      index: 2,
      rate: DEFAULT_NARRATION_RATE,
    });
    expect(narrationReducer(errored, { type: 'prev' }, 4)).toEqual({
      status: 'paused',
      index: 0,
      rate: DEFAULT_NARRATION_RATE,
    });
    expect(narrationReducer(errored, { type: 'seek', index: 3 }, 4)).toEqual({
      status: 'paused',
      index: 3,
      rate: DEFAULT_NARRATION_RATE,
    });
  });

  it('keeps the reason across a stop, and drops it over an empty script', () => {
    const errored = narrationReducer(playing(1), { type: 'speechError' }, 4);
    expect(narrationReducer(errored, { type: 'stop' }, 4)).toEqual(errored);
    expect(narrationReducer(errored, { type: 'play' }, 0)).toEqual({
      status: 'idle',
      index: 0,
      rate: DEFAULT_NARRATION_RATE,
    });
  });

  it('stops to paused, and leaves a finished deck finished', () => {
    expect(narrationReducer(playing(1), { type: 'stop' }, 4).status).toBe('paused');
    const ended: NarrationPlayerState = { status: 'ended', index: 3, rate: 1 };
    expect(narrationReducer(ended, { type: 'stop' }, 4).status).toBe('ended');
  });
});

describe('clampNarrationRate', () => {
  it('snaps onto the ladder and survives nonsense', () => {
    expect(clampNarrationRate(1.3)).toBe(1.25);
    expect(clampNarrationRate(9)).toBe(1.5);
    expect(clampNarrationRate(0)).toBe(0.8);
    expect(clampNarrationRate(undefined)).toBe(DEFAULT_NARRATION_RATE);
    expect(clampNarrationRate(Number.NaN)).toBe(DEFAULT_NARRATION_RATE);
    expect(initialNarrationState(1.3)).toEqual({ status: 'idle', index: 0, rate: 1.25 });
  });
});

describe('moving by page', () => {
  it('maps the cursor to a page and back', () => {
    expect(currentPageIndex(script, 1)).toBe(0);
    expect(currentPageIndex(script, 2)).toBe(1);
    expect(currentPageIndex(script, 99)).toBe(2);
    expect(currentPageIndex([], 3)).toBe(0);
    expect(firstSegmentOfPage(script, 1)).toBe(2);
    expect(firstSegmentOfPage(script, 9)).toBe(0);
  });

  it('skips whole pages, not segments, and stops at both ends', () => {
    expect(nextPageSegment(script, 0)).toBe(2);
    expect(nextPageSegment(script, 3)).toBe(3);
    expect(prevPageSegment(script, 3)).toBe(2);
    expect(prevPageSegment(script, 1)).toBe(0);
    expect(prevPageSegment(script, 0)).toBe(0);
  });

  it('lands on narrated pages only, when the blank ones were skipped', () => {
    expect(nextPageSegment(gappy, 0)).toBe(1);
    expect(prevPageSegment(gappy, 2)).toBe(1);
    expect(prevPageSegment(gappy, 1)).toBe(0);
    expect(nextPageSegment([], 0)).toBe(0);
    expect(prevPageSegment([], 0)).toBe(0);
  });
});

describe('narrationPositionLabel', () => {
  it('counts pages, never segments', () => {
    expect(narrationPositionLabel(script, 1)).toBe('Page 1 of 3');
    expect(narrationPositionLabel(script, 3, 12)).toBe('Page 3 of 12');
  });

  it('never claims fewer pages than the one being shown', () => {
    // A 60-page deck narrated to the 40-page cap: the count is the script's.
    expect(narrationPositionLabel(gappy, 2, 7)).toBe('Page 7 of 7');
    expect(narrationPositionLabel(gappy, 2, 1)).toBe('Page 7 of 7');
  });

  it('says so when there is nothing to read', () => {
    expect(narrationPositionLabel([], 0)).toBe('Nothing to read yet');
  });
});
