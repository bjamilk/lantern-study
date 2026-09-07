/**
 * Read-it-to-me, the web half.
 *
 * The cross-platform decisions — where the cursor is, what a button press
 * means, how a page-skip maps onto segments, how the position is spoken — live
 * in `@lantern/shared/notes` (`narrationReducer` and friends) so a deck paces
 * identically in a browser and on a phone. They are re-exported here rather
 * than reimplemented; a second copy of that arithmetic is exactly how the two
 * clients drift.
 *
 * What is left is genuinely web-only, and it is all here:
 *
 *   - `speechSynthesis` may not exist, and when it does not the student gets
 *     an honest closed door rather than a play button that does nothing.
 *     `narrationAvailability` is the only thing allowed to decide that.
 *   - The browser hands out a list of voices; nothing on mobile does.
 *   - `boundary` events give a character offset, which is how the spoken word
 *     is highlighted — and every engine reports `charLength` differently.
 *   - The listening position is remembered in localStorage, which no phone
 *     has, and a remembered position is always a hint, never a fact: it is
 *     clamped onto the script as it exists NOW, because a regenerated script
 *     can be shorter than the one the student last heard.
 */
import {
  DEFAULT_NARRATION_RATE,
  NARRATION_FOREGROUND_NOTICE,
  NARRATION_RATES,
  clampNarrationRate,
  currentPageIndex,
  firstSegmentOfPage,
  initialNarrationState,
  narrationPositionLabel,
  narrationReducer,
  nextPageSegment,
  prevPageSegment,
  type NarrationAction,
  type NarrationPlaybackStatus,
  type NarrationPlayerState,
  type PlayablePageSegment,
} from '@lantern/shared/notes';
import {
  formatNarrationDuration,
  narrationDuration,
  segmentsForPage,
  type NarrationScriptSegment,
  type NarrationScriptStatus,
  type NarrationUnavailableReason,
} from '@lantern/shared/notes/narration';
import {
  MAX_NARRATION_PAGES,
  NARRATION_SHORT_MAX_PAGES,
  formatCreditCost,
  formatNarrationPrice,
  getNarrationCreditCost,
} from '@lantern/shared/utils/aiCredits';

export {
  DEFAULT_NARRATION_RATE,
  MAX_NARRATION_PAGES,
  NARRATION_FOREGROUND_NOTICE,
  NARRATION_RATES,
  NARRATION_SHORT_MAX_PAGES,
  clampNarrationRate,
  currentPageIndex,
  firstSegmentOfPage,
  formatCreditCost,
  formatNarrationDuration,
  formatNarrationPrice,
  getNarrationCreditCost,
  initialNarrationState,
  narrationDuration,
  narrationPositionLabel,
  narrationReducer,
  nextPageSegment,
  prevPageSegment,
  segmentsForPage,
};
export type {
  NarrationAction,
  NarrationPlaybackStatus,
  NarrationPlayerState,
  NarrationScriptSegment,
  NarrationScriptStatus,
  NarrationUnavailableReason,
  PlayablePageSegment,
};

/* --------------------------------------------------------------- speed -- */

/**
 * "1.25×" — the label on the one speed button.
 *
 * Trailing zeros trimmed, so normal speed reads "1×" and not "1.00×".
 */
export function formatSpeed(rate: number): string {
  const clamped = clampNarrationRate(rate);
  const text = Number.isInteger(clamped) ? String(clamped) : String(Number(clamped.toFixed(2)));
  return `${text}×`;
}

/**
 * The next rate on the ladder, wrapping.
 *
 * One button rather than a menu: there are four rates, and a select for four
 * values costs a student more taps than it saves. A stored rate from an older
 * build snaps onto the ladder first (`clampNarrationRate`), so the cycle can
 * never get stuck between two steps.
 */
export function nextSpeed(current: number): number {
  const snapped = clampNarrationRate(current);
  const at = NARRATION_RATES.indexOf(snapped as (typeof NARRATION_RATES)[number]);
  if (at < 0) return DEFAULT_NARRATION_RATE;
  return NARRATION_RATES[(at + 1) % NARRATION_RATES.length];
}

/* ------------------------------------------------------------ resuming -- */

export interface NarrationPosition {
  segmentIndex: number;
  rate: number;
  /** The `voiceURI` the student last used, if the browser offered a choice. */
  voiceURI?: string;
}

export const EMPTY_NARRATION_POSITION: NarrationPosition = {
  segmentIndex: 0,
  rate: DEFAULT_NARRATION_RATE,
};

/**
 * Read a remembered position back into something safe to use.
 *
 * Defensive throughout on purpose: the value comes out of localStorage, so it
 * can be from an older build, a different document, or a hand-edited string.
 * A bad field degrades to the default; nothing here throws.
 */
export function parseNarrationPosition(raw: unknown): NarrationPosition {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_NARRATION_POSITION };
  const value = raw as Partial<NarrationPosition>;
  return {
    segmentIndex:
      typeof value.segmentIndex === 'number' &&
      Number.isFinite(value.segmentIndex) &&
      value.segmentIndex >= 0
        ? Math.floor(value.segmentIndex)
        : 0,
    rate: clampNarrationRate(typeof value.rate === 'number' ? value.rate : DEFAULT_NARRATION_RATE),
    voiceURI: typeof value.voiceURI === 'string' && value.voiceURI ? value.voiceURI : undefined,
  };
}

/**
 * Where a resumed session actually starts.
 *
 * Clamped onto the script we have now, and a position at the very end restarts
 * from the top: the student finished the document, so a "resume" that parks
 * forever on its last sentence is a dead player. This is the same call the
 * shared reducer makes for `play` out of `ended`, kept consistent on purpose.
 */
export function resumeSegmentIndex(
  segments: ReadonlyArray<PlayablePageSegment>,
  position: NarrationPosition
): number {
  if (segments.length === 0) return 0;
  if (!Number.isFinite(position.segmentIndex) || position.segmentIndex < 0) return 0;
  const at = Math.floor(position.segmentIndex);
  return at >= segments.length - 1 ? 0 : at;
}

/**
 * "Pick up on page 4" — what the play button says when there is somewhere to
 * pick up. Null at the start, where "Resume" would promise nothing.
 */
export function resumeLabel(
  segments: ReadonlyArray<PlayablePageSegment>,
  position: NarrationPosition
): string | null {
  const index = resumeSegmentIndex(segments, position);
  if (index <= 0) return null;
  return `Pick up on page ${currentPageIndex(segments, index) + 1}`;
}

/* -------------------------------------------------------------- voices -- */

export interface NarrationVoice {
  voiceURI: string;
  name: string;
  lang: string;
  default?: boolean;
  localService?: boolean;
}

/**
 * Which voice to speak in.
 *
 * Preference order: the one the student picked last, then a voice that runs ON
 * the device — those keep working with no network, which is the whole point of
 * on-device speech — then whatever the browser calls its default, then the
 * first in the list.
 *
 * Null when the browser lists no voices at all. That is legal and common on a
 * cold load (Chrome fills the list asynchronously), and it means "let the
 * engine choose", never "fail".
 */
export function pickNarrationVoice(
  voices: ReadonlyArray<NarrationVoice>,
  preferredURI?: string,
  lang = 'en'
): NarrationVoice | null {
  if (!voices || voices.length === 0) return null;
  if (preferredURI) {
    const remembered = voices.find((voice) => voice.voiceURI === preferredURI);
    if (remembered) return remembered;
  }
  const prefix = (lang || 'en').slice(0, 2).toLowerCase();
  const matching = voices.filter((voice) => (voice.lang || '').toLowerCase().startsWith(prefix));
  const pool = matching.length > 0 ? matching : voices;
  return pool.find((v) => v.localService) ?? pool.find((v) => v.default) ?? pool[0];
}

/* -------------------------------------------------------- availability -- */

export type NarrationAvailability =
  | 'ready'
  | 'unsupported'
  | 'no_script'
  | 'writing'
  | 'failed'
  | 'empty_script';

export interface NarrationAvailabilityState {
  status: NarrationAvailability;
  canPlay: boolean;
  /** What the student is told. Null only when the player can actually play. */
  message: string | null;
}

/**
 * Can this browser read the script aloud, and is there a script to read?
 *
 * The `unsupported` branch is the one that matters. `speechSynthesis` is
 * missing on some embedded and locked-down browsers, and a play button that
 * spins forever teaches a student the app is broken — which is worse than a
 * feature that says plainly it cannot run here. The written script is still
 * shown in that state, so the page is not a dead end.
 *
 * The script's own server-side state is folded in here too, because from the
 * student's side "my browser cannot speak" and "the words are still being
 * written" are the same question: can I press play yet?
 */
export function narrationAvailability(input: {
  speechSupported: boolean;
  segments: ReadonlyArray<PlayablePageSegment>;
  scriptStatus?: NarrationScriptStatus | null;
  errorMessage?: string | null;
}): NarrationAvailabilityState {
  if (!input.speechSupported) {
    return {
      status: 'unsupported',
      canPlay: false,
      message:
        'This browser cannot read aloud. The script is below to read yourself, and playing it works in Chrome, Edge and Safari, or in the Lantern app.',
    };
  }
  if (!input.scriptStatus) {
    return { status: 'no_script', canPlay: false, message: 'No one has had this read out yet.' };
  }
  if (input.scriptStatus === 'queued' || input.scriptStatus === 'generating') {
    return {
      status: 'writing',
      canPlay: false,
      message: 'The narration is being written. This usually takes under a minute.',
    };
  }
  if (input.scriptStatus === 'failed') {
    return {
      status: 'failed',
      canPlay: false,
      message:
        input.errorMessage ||
        'The reading could not be written. Your AI use for it was refunded — try again.',
    };
  }
  if (input.segments.length === 0) {
    return {
      status: 'empty_script',
      canPlay: false,
      message: 'The narration came back empty — there was no readable text to read out.',
    };
  }
  return { status: 'ready', canPlay: true, message: null };
}

/**
 * What to tell the student when the route came back with no script at all.
 * Null means there is one.
 *
 * None of these branches uses the word "error": a document uploaded before the
 * page model existed, and a photo that will never have pages, are ordinary
 * states of the app, not faults.
 */
export function narrationUnavailableMessage(
  reason: 'ok' | NarrationUnavailableReason,
  segmentCount = 0
): string | null {
  if (reason === 'ok' && segmentCount > 0) return null;
  switch (reason) {
    case 'not_generated':
      return 'No one has had this read out yet.';
    case 'schema_missing':
      return 'Reading aloud is not switched on in this environment yet.';
    case 'no_pages':
      return 'This document has not been split into pages yet, so there is nothing to read aloud.';
    case 'failed':
      return 'The reading could not be written. Your AI use for it was refunded — try again.';
    default:
      return 'There is nothing in this document to read out.';
  }
}

/* ----------------------------------------------------------- highlight -- */

export interface HighlightRange {
  start: number;
  end: number;
}

/**
 * The word to highlight, from a `boundary` event.
 *
 * Engines disagree about `charLength`: Chrome supplies it, several report 0 or
 * omit it, and Safari has shipped both. So the length is derived from the text
 * when it is not given, by reading to the next space — which is what a word
 * boundary means anyway.
 *
 * Null when the index falls outside the text, so a late event from an
 * utterance that was already cancelled cannot highlight a slice of the NEXT
 * segment.
 */
export function highlightRangeForBoundary(
  text: string,
  charIndex: number,
  charLength?: number
): HighlightRange | null {
  const source = typeof text === 'string' ? text : '';
  if (!source) return null;
  if (!Number.isFinite(charIndex) || charIndex < 0 || charIndex >= source.length) return null;
  const start = Math.floor(charIndex);
  if (Number.isFinite(charLength) && (charLength as number) > 0) {
    return { start, end: Math.min(source.length, start + Math.floor(charLength as number)) };
  }
  const nextSpace = source.slice(start).search(/\s/);
  return { start, end: nextSpace < 0 ? source.length : start + nextSpace };
}

/** The three pieces a highlighted segment renders as. */
export function splitForHighlight(
  text: string,
  range: HighlightRange | null
): { before: string; word: string; after: string } {
  const source = typeof text === 'string' ? text : '';
  if (!range || range.end <= range.start) return { before: source, word: '', after: '' };
  const start = Math.max(0, Math.min(source.length, range.start));
  const end = Math.max(start, Math.min(source.length, range.end));
  return {
    before: source.slice(0, start),
    word: source.slice(start, end),
    after: source.slice(end),
  };
}
