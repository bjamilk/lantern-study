/**
 * The lecture recorder's TRANSCRIPT DRAWER: its state machine, its chunk list
 * and the labels the floating tab pill wears.
 *
 * Exports: `lectureDrawerReducer` + the drawer model, `growLectureChunks` /
 * `sealLectureChunks` + the chunk model, `lectureTabPillLabels`,
 * `lectureDrawerCopy`.
 * Touches: nothing. Every function here is pure — no store, no clock of its
 * own, no DOM — so the same reducer runs the web drawer and the phone's
 * Transcript tab, and neither can invent a state the other does not have.
 *
 * WHY A REDUCER AND NOT SIX BOOLEANS. The recorder screen has six visual
 * states (pre-check, consent, recording, minimised, saving, done) and four of
 * them were previously derived at render from three independent flags
 * (`consented`, `status`, `recording`). That is how the reference product ends
 * up showing "⟳ Generating…" on a tab beside a "Failed to refine notes" pill:
 * two truths about one screen, each written by a different handler. One
 * reducer, one truth, and the failure path is a transition like any other.
 *
 * WHAT IS NOT IN HERE. Capture, upload, transcription and money. Those live in
 * `lectureSegments.ts` and the recording store and are untouched by this
 * module: the drawer PRESENTS a take, it does not run one.
 */

/* -------------------------------------------------------------- the steps -- */

/**
 * Where the drawer is in a lecture.
 *
 *  - `precheck` — waveform, quality card, mic picker, the big black Start.
 *  - `consent`  — "Recording consent", shown AFTER the pre-check and only on a
 *    lecture whose account has not answered it before.
 *  - `recording`— the growing chunk list and the black recording pill.
 *  - `saving`   — Stop pressed, the last segment still uploading/transcribing.
 *  - `done`     — the chunks, "Create notes from transcript?" and Resume.
 */
export type LectureDrawerStep = 'precheck' | 'consent' | 'recording' | 'saving' | 'done';

export interface LectureDrawerModel {
  step: LectureDrawerStep;
  /** The drawer is collapsed to the small floating widget. */
  minimised: boolean;
  /** The drawer is closed altogether (the Record tab re-opens it). */
  open: boolean;
  /**
   * This account has already agreed to the consent card.
   *
   * Remembered per account through the settings path, not per lecture: a
   * student who has answered "Yes, record now" once should not be asked again
   * every Tuesday. It is carried IN the model so the reducer is a pure
   * function of its input and the persistence is the caller's business.
   */
  consentRemembered: boolean;
}

export type LectureDrawerEvent =
  /** The Record tab was pressed (or the studio opened on a fresh lecture). */
  | { type: 'open' }
  /** × "Close transcript". */
  | { type: 'close' }
  /** The big Start button under the pre-check. */
  | { type: 'start-pressed' }
  | { type: 'consent-granted' }
  | { type: 'consent-declined' }
  /** The take is actually running (the store answered). */
  | { type: 'recording-started' }
  | { type: 'minimise' }
  | { type: 'expand' }
  /** ⏹ — the microphone is down, the last segment is not in yet. */
  | { type: 'stop' }
  /** Every segment is uploaded and transcribed. */
  | { type: 'saved' }
  /** 🎙 Resume — carry on into the SAME take. */
  | { type: 'resume' }
  /** The take was thrown away; back to a clean pre-check. */
  | { type: 'discard' };

export function initialLectureDrawer(
  input: { consentRemembered?: boolean; open?: boolean } = {}
): LectureDrawerModel {
  return {
    step: 'precheck',
    minimised: false,
    open: input.open ?? false,
    consentRemembered: Boolean(input.consentRemembered),
  };
}

/**
 * The whole state machine.
 *
 * Two rules worth stating, because both were bugs in the product this screen
 * is measured against:
 *
 *  1. STOP ALWAYS EXPANDS. A minimised widget that stays minimised through
 *     "Saving your recording…" hides the only reassurance the student wants at
 *     the one moment they want it, and the widget has nowhere to put that
 *     sentence. So `stop` clears `minimised`.
 *  2. CONSENT IS ASKED ONCE AND THEN REMEMBERED. `consent-granted` sets
 *     `consentRemembered`, and a later `start-pressed` goes straight to
 *     recording. Declining does NOT clear the memory of a previous yes — it
 *     only refuses this take.
 */
export function lectureDrawerReducer(
  state: LectureDrawerModel,
  event: LectureDrawerEvent
): LectureDrawerModel {
  switch (event.type) {
    case 'open':
      // Re-opening from the minimised widget is an expand, never a reset: a
      // take that is running keeps its step.
      return { ...state, open: true, minimised: false };

    case 'close':
      // Closing during a take does not stop it. The pill has to stay reachable,
      // so a running take closes to the minimised widget instead of vanishing.
      if (state.step === 'recording') return { ...state, minimised: true };
      return { ...state, open: false, minimised: false };

    case 'start-pressed':
      if (state.step !== 'precheck') return state;
      return state.consentRemembered
        ? { ...state, step: 'recording', open: true, minimised: false }
        : { ...state, step: 'consent', open: true, minimised: false };

    case 'consent-granted':
      if (state.step !== 'consent') return state;
      return { ...state, step: 'recording', consentRemembered: true, minimised: false };

    case 'consent-declined':
      if (state.step !== 'consent') return state;
      return { ...state, step: 'precheck' };

    case 'recording-started':
      return { ...state, step: 'recording', open: true };

    case 'minimise':
      if (state.step !== 'recording') return state;
      return { ...state, minimised: true };

    case 'expand':
      return { ...state, minimised: false, open: true };

    case 'stop':
      if (state.step !== 'recording') return state;
      return { ...state, step: 'saving', minimised: false, open: true };

    case 'saved':
      if (state.step !== 'saving') return state;
      return { ...state, step: 'done', minimised: false };

    case 'resume':
      if (state.step !== 'done') return state;
      return { ...state, step: 'recording', minimised: false, open: true };

    case 'discard':
      return { ...state, step: 'precheck', minimised: false };

    default:
      return state;
  }
}

/** Is a take running or finishing? Nothing may be torn down while this is true. */
export function lectureDrawerIsLive(state: LectureDrawerModel): boolean {
  return state.step === 'recording' || state.step === 'saving';
}

/* --------------------------------------------------------------- the copy -- */

/**
 * Every string the drawer says, in one place.
 *
 * Measured off the reference where the reference is honest and rewritten where
 * it is not: Lantern's pre-check keeps its own cost line, and the enhance
 * failure says what failed rather than leaving a tab spinning.
 */
export const lectureDrawerCopy = {
  title: 'Transcript',
  close: 'Close transcript',
  settings: 'Recorder settings',
  minimise: 'Minimize transcript',
  expand: 'Expand transcript',
  listening: '● Listening…',
  consentTitle: 'Recording consent',
  consentBody: 'Ensure all participants consent to being recorded',
  consentNo: 'No',
  consentYes: 'Yes, record now',
  savingTitle: 'Saving your recording',
  savingBody: 'Please wait while we save your transcript and audio…',
  doneTitle: 'Create notes from transcript?',
  resume: 'Resume',
  stop: 'Stop recording',
  enhancing: 'Saving enhanced notes…',
  enhanceFailed: 'Could not enhance notes',
} as const;

/* ----------------------------------------------------------- the tab pill -- */

export type LectureTabPillId = 'notes' | 'enhanced' | 'materials' | 'audio' | 'record';

export interface LectureTabPillState {
  /** A take is running: the Record tab becomes the way back to the transcript. */
  recording: boolean;
  /** An enhance is in flight. */
  enhancing: boolean;
  /** Enhanced notes exist, so that tab is reachable. */
  hasEnhanced: boolean;
}

export interface LectureTabPillItem {
  id: LectureTabPillId;
  label: string;
  /** Greyed, with `hint` as its tooltip. */
  disabled: boolean;
  hint?: string;
  /** The dark chip: the reference draws Record in ink, not in white. */
  emphasis?: 'ink';
}

/**
 * The five tabs, in the reference's order, with the two labels that change.
 *
 * The one thing this function guarantees that a render-time ternary did not:
 * `enhancing` and `recording` are read from the SAME input, so the tab cannot
 * say "Generating…" after the generate has failed. When the enhance ends —
 * either way — the caller passes `enhancing: false` and the label is whatever
 * this table says it is.
 */
export function lectureTabPillLabels(state: LectureTabPillState): LectureTabPillItem[] {
  return [
    { id: 'notes', label: 'My Notes', disabled: false },
    {
      id: 'enhanced',
      label: state.enhancing ? '⟳ Generating…' : 'Enhanced Notes',
      disabled: !state.hasEnhanced && !state.enhancing,
      ...(!state.hasEnhanced && !state.enhancing
        ? { hint: 'Enhance this lecture to fill this tab.' }
        : {}),
    },
    { id: 'materials', label: 'Material', disabled: false },
    { id: 'audio', label: 'Audio Files', disabled: false },
    {
      id: 'record',
      label: state.recording ? '≡ Transcript' : '🎙 Record',
      disabled: false,
      emphasis: 'ink',
    },
  ];
}

/* ------------------------------------------------------------- the chunks -- */

/**
 * How long a silence has to last before the transcript starts a new card.
 *
 * Measured off the reference: one card grew for 1:35 of continuous speech and a
 * new one opened at a pause. Two seconds is the gap between "the lecturer took
 * a breath" and "the lecturer moved on", and it is the only rule that does not
 * need a boundary from the transcription pipeline.
 */
export const LECTURE_CHUNK_PAUSE_MS = 2_000;

export interface LectureChunk {
  /** Stable across grows, so React keys and scroll anchors do not jump. */
  id: string;
  startMs: number;
  /** The last moment words landed in this chunk. Becomes the stamp after Stop. */
  endMs: number;
  text: string;
  /** `caption` is the browser's own live text; `segment` is the real transcript. */
  source: 'caption' | 'segment';
  /** Set when a real segment replaced the captions, so nothing replaces it twice. */
  segmentSeq?: number;
}

export interface GrowLectureChunksInput {
  chunks: LectureChunk[];
  /** The captions for the chunk in progress, WHOLE — not a delta. */
  text: string;
  /** Recorded milliseconds at this moment. */
  atMs: number;
  /**
   * Start a new chunk whatever the pause says — a segment closed, so the next
   * words belong to the next card.
   */
  boundary?: boolean;
}

/**
 * Grow the open chunk in place, or start a new one.
 *
 * THE GROW IS THE POINT. The reference's open card reached 1306px of text
 * without ever being replaced: a card that is re-created per caption revision
 * makes the list flicker and steals the student's scroll position every few
 * seconds. So the open chunk keeps its id and its `startMs` and only its `text`
 * and `endMs` move.
 *
 * A new chunk starts on exactly two conditions, both of them explicit:
 *   - a pause of `LECTURE_CHUNK_PAUSE_MS` or more since the open chunk's last
 *     words, or
 *   - `boundary`, which the recorder sets when a segment closes.
 */
export function growLectureChunks(input: GrowLectureChunksInput): LectureChunk[] {
  const text = (input.text ?? '').trim();
  const atMs = Math.max(0, Number.isFinite(input.atMs) ? input.atMs : 0);
  const chunks = input.chunks ?? [];
  if (!text) return chunks;

  const open = chunks.length ? chunks[chunks.length - 1] : undefined;
  const openIsCaption = open && open.source === 'caption';
  const paused = open ? atMs - open.endMs >= LECTURE_CHUNK_PAUSE_MS : false;

  if (!open || !openIsCaption || paused || input.boundary) {
    return [
      ...chunks,
      {
        id: `c${atMs}-${chunks.length + 1}`,
        startMs: atMs,
        endMs: atMs,
        text,
        source: 'caption',
      },
    ];
  }

  const grown: LectureChunk = { ...open, text, endMs: atMs };
  return [...chunks.slice(0, -1), grown];
}

/**
 * Replace the captions of a span with the segment's real transcript.
 *
 * Captions are a placeholder for a span, never a second transcript of it (the
 * rule `LectureSegmentList` already states). A segment whose card is already
 * here — matched by `segmentSeq` — is replaced rather than appended, so a retry
 * of segment 3 after 4 and 5 have landed does not duplicate minute 10.
 */
export function applyLectureSegmentToChunks(input: {
  chunks: LectureChunk[];
  seq: number;
  startOffsetMs: number;
  durationMs: number;
  text: string;
}): LectureChunk[] {
  const text = (input.text ?? '').trim();
  const startMs = Math.max(0, input.startOffsetMs);
  const endMs = startMs + Math.max(0, input.durationMs);
  const row: LectureChunk = {
    id: `s${input.seq}`,
    startMs,
    endMs,
    text,
    source: 'segment',
    segmentSeq: input.seq,
  };

  const rest = (input.chunks ?? []).filter((chunk) => {
    if (chunk.segmentSeq === input.seq) return false;
    // Captions inside this segment's span are what the real words replace.
    if (chunk.source === 'caption' && chunk.startMs >= startMs && chunk.startMs < endMs) {
      return false;
    }
    return true;
  });

  return [...rest, row].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

/**
 * After Stop, the stamps are the chunk END times.
 *
 * The reference's finished list reads `1:48`, `2:43` — where each piece of
 * speech ENDED, not where it began. During the lecture the start is the useful
 * number (it is the moment you can scrub back to while the card is still
 * growing); afterwards the end is, because it is what the next card follows.
 */
export function sealLectureChunks(chunks: LectureChunk[]): LectureChunk[] {
  return (chunks ?? []).map((chunk) => ({
    ...chunk,
    endMs: Math.max(chunk.endMs, chunk.startMs),
  }));
}

/** The stamp a chunk shows: start while the take runs, end once it is saved. */
export function lectureChunkStampMs(chunk: LectureChunk, sealed: boolean): number {
  return sealed ? chunk.endMs : chunk.startMs;
}
