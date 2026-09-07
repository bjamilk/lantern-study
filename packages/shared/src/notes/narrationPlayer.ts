/**
 * "Read it to me" — the player's decisions, with no player in them.
 *
 * `narration.ts` next door is the SCRIPT: what the server writes, how long it
 * takes to say, and which segment belongs to which page. This file is the
 * other half — where the cursor is, what a button press means, and how the
 * position is spoken. Both platforms share it so a deck paces identically on
 * a phone and in a browser.
 *
 * The shape is forced by what a speech engine actually is. Neither
 * `speechSynthesis` nor `expo-speech` is a media player: there is no seekable
 * timeline, no true duration, and on Android no reliable word-boundary
 * callback (`onBoundary` fires on some engines, never on others, and on a few
 * it fires once at the start). What both DO report honestly is "this utterance
 * finished". So the player is a cursor over an ordered list of segments,
 * advanced by completion, and `segmentDone` is an ACTION rather than a timer:
 * position is what the engine has actually finished saying, never what a clock
 * guessed it should have.
 *
 * Pure and import-free at runtime — the one import below is a type.
 */

/* ------------------------------------------------------------- the cursor -- */

/**
 * The only thing the cursor needs to know about a segment: which page it
 * belongs to.
 *
 * Structural on purpose, and NOT an import of the script's own row type. The
 * player is downstream of the script — it should keep working while the script
 * grows fields — and a structural parameter means the server's rows, a locally
 * cached copy and a test fixture all satisfy it without a conversion step.
 */
export interface PlayablePageSegment {
  /** 0-based, matching `note_attachment_pages.page_index`. */
  pageIndex: number;
}

/**
 * Playback state. Deliberately NOT `NarrationStatus`, which is the SCRIPT's
 * state on the server (queued/generating/ready/failed) — a ready script and a
 * paused player are two different facts and one word for both would hide it.
 *
 * `error` is here because a speech engine can refuse ONE paragraph — a
 * language it has no voice for, a string it chokes on, an engine killed by the
 * OS mid-utterance — and the honest answer to that is a stop with a reason, not
 * a silent skip. Before this state existed both platforms mapped the engine's
 * `onError` onto `segmentDone`, so a phone with no working voice raced through
 * every paragraph in milliseconds and parked on "Finished" having said nothing.
 * A student cannot debug that; they can act on "this paragraph would not play".
 */
export type NarrationPlaybackStatus = 'idle' | 'playing' | 'paused' | 'ended' | 'error';

export interface NarrationPlayerState {
  status: NarrationPlaybackStatus;
  /** Which segment is current. Always a valid index while a script exists. */
  index: number;
  /** Speaking rate multiplier, one of `NARRATION_RATES`. */
  rate: number;
  /**
   * Why the reading stopped, in the student's words. Set only alongside
   * `status: 'error'` and cleared by anything that moves on from it — a
   * reason left behind after a successful retry is a stale accusation.
   */
  errorReason?: string;
}

export type NarrationAction =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'toggle' }
  /** The speech engine finished the current utterance. The ONLY auto-advance. */
  | { type: 'segmentDone' }
  /**
   * The engine refused the current utterance. Never advances — this is the
   * whole point of the state: the paragraph that failed is the paragraph the
   * student is still on.
   */
  | { type: 'speechError'; reason?: string }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'seek'; index: number }
  | { type: 'setRate'; rate: number }
  /** Leaving the screen, or the app going to the background. */
  | { type: 'stop' };

/**
 * The rates offered. Four steps, not a slider: a slider over a TTS engine that
 * quantises rate internally gives the student a control that does nothing for
 * most of its travel.
 */
export const NARRATION_RATES = [0.8, 1, 1.25, 1.5] as const;

export const DEFAULT_NARRATION_RATE = 1;

/** Snap any rate onto the offered ladder — a rate stored by an older build included. */
export function clampNarrationRate(rate: number | null | undefined): number {
  if (!Number.isFinite(rate as number)) return DEFAULT_NARRATION_RATE;
  let best: number = NARRATION_RATES[0];
  let bestGap = Infinity;
  for (const candidate of NARRATION_RATES) {
    const gap = Math.abs(candidate - (rate as number));
    if (gap < bestGap) {
      bestGap = gap;
      best = candidate;
    }
  }
  return best;
}

export function initialNarrationState(rate?: number | null): NarrationPlayerState {
  return { status: 'idle', index: 0, rate: clampNarrationRate(rate) };
}

/**
 * Drop a stale reason on the way out of `error`. Written as a rest-destructure
 * rather than `errorReason: undefined` so the key is genuinely gone: a state
 * carrying `errorReason: undefined` is not `toEqual` a state without it, and a
 * test that has to know which of the two it got is a test of nothing.
 */
function withoutError(state: NarrationPlayerState): NarrationPlayerState {
  if (state.errorReason === undefined) return state;
  const { errorReason: _dropped, ...rest } = state;
  return rest;
}

function clampIndex(index: number, total: number): number {
  if (total <= 0) return 0;
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(0, Math.trunc(index)), total - 1);
}

/**
 * The player, as a reducer.
 *
 * Four rules worth stating, because each is a place a media player usually
 * gets it wrong:
 *
 * 1. `segmentDone` is the only thing that moves the cursor on its own, and at
 *    the last segment it ENDS rather than looping. A deck that restarts itself
 *    while a student is still reading the last page is the podcast-app bug
 *    nobody asked for.
 * 2. `segmentDone` is ignored unless the player is playing. A stale callback
 *    from an utterance that was cancelled on pause must not walk the cursor
 *    forward behind a paused button.
 * 3. Skipping while paused stays paused. The student pressed skip, not play;
 *    an engine that starts talking because they turned a page is startling on
 *    a phone in a lecture hall.
 * 4. Changing the rate does not move the cursor. The caller re-speaks the
 *    CURRENT segment at the new rate — no engine can retune an utterance in
 *    flight, and repeating one paragraph is a smaller cost than skipping one.
 * 5. `speechError` STOPS on the failing segment and never advances, and it is
 *    ignored unless the player is playing — which is also what makes a second
 *    error on the same paragraph a no-op rather than a loop. Retrying is a
 *    press of play: it re-speaks the SAME paragraph, and only the student's own
 *    skip moves past it.
 */
export function narrationReducer(
  state: NarrationPlayerState,
  action: NarrationAction,
  total: number
): NarrationPlayerState {
  if (total <= 0) {
    // Nothing to say. Every action collapses to idle rather than parking the
    // UI in "playing" over an empty script — and an empty script cannot be the
    // paragraph that failed, so any reason goes with it.
    return { ...withoutError(state), status: 'idle', index: 0 };
  }
  switch (action.type) {
    case 'play':
      // Play at the end restarts from the top: "ended" is a finished deck, and
      // the only sensible meaning of pressing play on one is "again".
      //
      // Play out of `error` is the RETRY, and it deliberately does not move the
      // cursor: the student pressed play on the paragraph that failed, so that
      // is the paragraph they get. Restarting the deck there would silently
      // throw away everything they had already heard.
      return state.status === 'ended'
        ? { ...withoutError(state), status: 'playing', index: 0 }
        : { ...withoutError(state), status: 'playing' };
    case 'pause':
      return state.status === 'playing' ? { ...state, status: 'paused' } : state;
    case 'toggle':
      return narrationReducer(state, { type: state.status === 'playing' ? 'pause' : 'play' }, total);
    case 'segmentDone': {
      if (state.status !== 'playing') return state;
      const next = state.index + 1;
      if (next >= total) return { ...state, status: 'ended', index: total - 1 };
      return { ...state, index: next };
    }
    case 'speechError': {
      // Ignored unless playing, for the same reason `segmentDone` is (rule 2):
      // `Speech.stop()` fires the cancelled utterance's callbacks, so a pause or
      // a skip can arrive here as an error a moment later, and a paused deck
      // must not repaint itself red. It also means a second error on the same
      // segment lands on an already-errored state and changes nothing — the
      // engine cannot spin the player by failing twice.
      if (state.status !== 'playing') return state;
      return {
        ...state,
        status: 'error',
        errorReason: action.reason || 'This phone could not read that paragraph out loud.',
      };
    }
    case 'next': {
      // Skipping is the student's other way out of an error: they read the
      // paragraph themselves and move on. The deck stays where it was —
      // stopped — rather than starting to talk because they pressed skip.
      const base = state.status === 'error'
        ? { ...withoutError(state), status: 'paused' as const }
        : state;
      const next = base.index + 1;
      if (next >= total) return { ...base, status: 'ended', index: total - 1 };
      return { ...base, index: next };
    }
    case 'prev': {
      // Back from the end re-opens the LAST segment rather than the one before
      // it: the student stopped listening at the end, and "back" from there
      // means "say that again".
      const from = state.status === 'ended' ? total : state.index;
      const prev = Math.max(0, from - 1);
      const status =
        state.status === 'ended' || state.status === 'error' ? 'paused' : state.status;
      return { ...withoutError(state), index: prev, status };
    }
    case 'seek': {
      const index = clampIndex(action.index, total);
      // A seek out of "ended" — or out of "error" — leaves the deck paused at
      // the target, ready and silent.
      const status =
        state.status === 'ended' || state.status === 'error' ? 'paused' : state.status;
      return { ...withoutError(state), index, status };
    }
    case 'setRate':
      return { ...state, rate: clampNarrationRate(action.rate) };
    case 'stop':
      // Leaving the screen does not un-fail anything. A deck that stopped with
      // a reason keeps it, so coming back says why it stopped instead of
      // offering a play button that will fail again with no explanation.
      if (state.status === 'ended' || state.status === 'error') return state;
      return { ...state, status: 'paused' };
    default:
      return state;
  }
}

/* ------------------------------------------------------- moving by page -- */

/**
 * The player advances by SEGMENT and the viewer shows a PAGE, and a long page
 * may be more than one segment. These four map between the two so a page-skip
 * control lands on the start of a page rather than somewhere inside it.
 *
 * Every one of them takes the segment list in playback order — which is what
 * `normalizeNarrationSegments` in narration.ts produces — and none of them
 * assumes pages are contiguous or start at zero: a document whose first two
 * pages are blank has no segments for them, and skipping back from page 3
 * must land on page 3's own first segment, not on a page that was never
 * narrated.
 */

/** Which page the cursor is standing on, or 0 for an empty script. */
export function currentPageIndex(
  segments: readonly PlayablePageSegment[],
  index: number
): number {
  // Read through a local rather than indexing inline: web compiles this file
  // with `noUncheckedIndexedAccess`, so an index expression is `T | undefined`
  // even when the length has just been checked.
  const at = segments[clampIndex(index, segments.length)];
  return at ? at.pageIndex : 0;
}

/** The first segment of a page — where "play from page N" lands. */
export function firstSegmentOfPage(
  segments: readonly PlayablePageSegment[],
  pageIndex: number
): number {
  const at = segments.findIndex((segment) => segment.pageIndex === pageIndex);
  return at >= 0 ? at : 0;
}

/** The first segment of the NEXT narrated page; the last segment at the end. */
export function nextPageSegment(
  segments: readonly PlayablePageSegment[],
  index: number
): number {
  if (!segments.length) return 0;
  const page = currentPageIndex(segments, index);
  const at = segments.findIndex((segment) => segment.pageIndex > page);
  return at >= 0 ? at : segments.length - 1;
}

/** The first segment of the PREVIOUS narrated page; segment 0 at the start. */
export function prevPageSegment(
  segments: readonly PlayablePageSegment[],
  index: number
): number {
  if (!segments.length) return 0;
  const page = currentPageIndex(segments, index);
  let target = -1;
  for (const segment of segments) {
    if (segment.pageIndex < page) target = segment.pageIndex;
  }
  return target < 0 ? 0 : firstSegmentOfPage(segments, target);
}

/* --------------------------------------------------------------- the copy -- */

/**
 * "Page 3 of 12" — the position line under the player.
 *
 * Stated in PAGES, never in segments. A student watching page 3 does not care
 * that they are on spoken paragraph 7 of 31, and a number that counts
 * something they cannot see is noise. `pageCount` is the script's own count —
 * how many pages were narrated — so a 60-page deck read to the 40-page cap
 * says "of 40" and does not imply twenty pages that are not there.
 */
export function narrationPositionLabel(
  segments: readonly PlayablePageSegment[],
  index: number,
  pageCount?: number
): string {
  if (!segments.length) return 'Nothing to read yet';
  const page = currentPageIndex(segments, index) + 1;
  const total = Math.max(page, pageCount || currentPageIndex(segments, segments.length - 1) + 1);
  return `Page ${page} of ${total}`;
}

/**
 * What the player says about staying on screen.
 *
 * Both engines stop when the app leaves the foreground: `expo-speech` is not a
 * background audio session, and a browser tab loses its speech queue. That is
 * a real limit of on-device speech, not a bug to be papered over, so the UI
 * states it up front rather than letting a student pocket the phone and come
 * back to silence at the same page.
 */
export const NARRATION_FOREGROUND_NOTICE =
  'Reading stops when you leave the app — the screen stays awake while it plays.';
