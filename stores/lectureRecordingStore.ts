/**
 * The one lecture recording in flight, in the browser.
 *
 * ## What changed, and why
 *
 * This store used to hold a whole lecture in memory as one `MediaRecorder`
 * take and upload it after Stop. A 90-minute lecture therefore had exactly one
 * moment of truth, at the very end: a tab crash, a closed lid or a killed
 * browser at minute 84 lost the lot, and the transcript did not exist until the
 * class was over.
 *
 * The take is now cut into segments. Every `LECTURE_SEGMENT_MS` the recorder is
 * STOPPED AND RESTARTED on the same `MediaStream`, so each closed segment is a
 * standalone, playable, transcribable file, and the elapsed clock — which lives
 * out here, not in the recorder — runs straight through the seam.
 * `MediaRecorder.start(timeslice)` cannot do this: only its first chunk carries
 * the container header, so chunk 7 on its own is neither playable nor
 * transcribable.
 *
 * Each closed segment is uploaded and transcribed WHILE the lecture continues,
 * so the transcript grows during class and the worst a crash can cost is the
 * piece still open. The browser's `SpeechRecognition` captions stay, but only
 * as a placeholder for the segment in progress: when Whisper answers for a
 * span, its text replaces the captions for that span.
 *
 * ## The rules this file keeps
 *
 * - A segment's audio is safe before its words are. `prepare` registers the
 *   segment on the note before the bytes leave the browser, so a reload can
 *   find a lecture this tab never finished.
 * - A failure is per segment, never per lecture. One refused segment shows a
 *   Retry on its own card; the rest of the lecture is unaffected and the
 *   recorder does not stop.
 * - Re-sending a segment is free. The server keys on `noteId:sessionId:seq`.
 * - Pauses are never billed and never rotate: `pausedTotalMs` is subtracted
 *   from the clock that decides where segment boundaries fall.
 */
import {
  elapsedRecordingMs,
  mergeCaptionStream,
  pausedTotalAfterResume,
} from '@lantern/shared';
import {
  LECTURE_AUDIO_BITS_PER_SECOND,
  LECTURE_AUDIO_CHANNELS,
  LECTURE_AUDIO_SAMPLE_RATE_HZ,
} from '@lantern/shared/utils/lectureAudio';
import {
  formatLectureSegmentStamp,
  lectureSegmentFileName,
  lectureSegmentRows,
  newLectureSessionId,
  resolveLectureResume,
  shouldRotateLectureSegment,
  type LectureSegmentRow,
} from '@lantern/shared/utils/lectureSegments';
import { create } from 'zustand';
import * as notesApi from '../services/notes';
import {
  MIN_LECTURE_RECORD_MS,
  encodeBlobAsWav,
  formatTranscribeDiag,
  waitForRecorderChunks,
} from '../services/lectureRecording';
import { fetchAIUsage } from '../services/ai';
import { useNotesStore } from './notesStore';
import { useToastStore } from './toastStore';

/**
 * `saving` is the state between Stop and the last segment landing: the
 * microphone is down and the lecture is over, but the final piece is still
 * being uploaded and transcribed. It is a distinct status rather than a
 * borrowed `uploading` because the copy differs — "Saving your recording…" is
 * a promise that nothing is lost, and it must not appear mid-lecture.
 */
export type LectureRecordingStatus =
  | 'idle'
  | 'recording'
  | 'saving'
  | 'uploading'
  | 'transcribing';

export type LectureSegmentUiStatus =
  | 'recording'
  | 'uploading'
  | 'transcribing'
  | 'done'
  | 'failed';

/** One card in the Transcript tab, and one row in the Audio files tab. */
export interface LectureSegmentUi {
  seq: number;
  startOffsetMs: number;
  durationMs: number;
  /** `0:00`, `5:00`, `1:05:00` — the gutter time on the card. */
  stamp: string;
  status: LectureSegmentUiStatus;
  transcript: string;
  error?: string;
  /** Present once the note holds the row, so the player can re-sign its URL. */
  attachmentId?: string;
  fileName?: string;
  fileUrl?: string;
  /** When the segment's row was written, for the Audio files tab's date. */
  createdAt?: string;
  /** True when this segment came back from the server rather than this take. */
  fromServer?: boolean;
}

interface LectureRecordingState {
  status: LectureRecordingStatus;
  noteId: string | null;
  noteTitle: string | null;
  startedAt: number | null;
  error: string | null;
  /** Bumps when elapsed UI should refresh (wall-clock). */
  tick: number;
  /** When the current pause began, or `null` while actually recording. */
  pausedAt: number | null;
  /** Milliseconds spent paused across the whole take. Never billed. */
  pausedTotalMs: number;
  /** Captions for the segment IN PROGRESS only. Whisper replaces them. */
  committedTranscript: string;
  /** In-progress caption, replaced as the speech engine revises it. */
  interimTranscript: string;
  /** The whole ordered transcript region of the note, as the server last wrote it. */
  whisperTranscript: string;
  /** Note the caption/whisper fields belong to, kept after idle. */
  transcriptNoteId: string | null;

  /** The take this store is recording or last recorded. */
  sessionId: string | null;
  /** Every segment of the open take, in recorded order. */
  segments: LectureSegmentUi[];
  /** Segments still uploading or transcribing. Stop waits for this to reach 0. */
  inFlight: number;

  start: (
    noteId: string,
    noteTitle: string,
    options?: {
      currentBody?: string;
      /** ISO-639-1 or 'auto'; narrowed again on the server. */
      language?: string;
      /** 'same' | 'en'; narrowed again on the server. */
      translateTo?: string;
      /** The microphone the pre-check panel is on, when the student picked one. */
      deviceId?: string | null;
      /** Carry on an interrupted take instead of starting a new one. */
      resume?: { sessionId: string; nextSeq: number; recordedMs: number };
    }
  ) => Promise<void>;
  stopAndTranscribe: (options?: { currentBody?: string }) => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
  discard: () => void;
  cancelTranscription: () => void;
  /** Transcribe one segment again. Its audio is already safe in storage. */
  retrySegment: (seq: number) => void;
  /** Read the note's own segment rows so a reload can offer to carry on. */
  hydrateFromNote: (
    noteId: string,
    attachments: Array<Record<string, unknown>> | null | undefined
  ) => void;
  /** Provide latest editor body for the active note (optional). */
  setCurrentBodyProvider: (provider: (() => string) | null) => void;
  isActiveForNote: (noteId: string) => boolean;
  isBusy: () => boolean;
}

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{ isFinal?: boolean; 0?: { transcript?: string } }>;
};

/** The audio of one closed segment, held until the server has its words. */
type HeldSegment = {
  blob: Blob;
  mimeType: string;
  seq: number;
  startOffsetMs: number;
  durationMs: number;
};

type SessionRefs = {
  mediaRecorder: MediaRecorder | null;
  mediaStream: MediaStream | null;
  chunks: Blob[];
  discard: boolean;
  abort: AbortController | null;
  recordingMime: string;
  currentBodyProvider: (() => string) | null;
  tickTimer: ReturnType<typeof setInterval> | null;
  recognition: SpeechRecognitionLike | null;
  captionWanted: boolean;
  /**
   * The language choices this take was started with. Captured at START rather
   * than read at stop, so changing the setting mid-lecture cannot relabel a
   * recording that is already half spoken.
   */
  language?: string;
  translateTo?: string;

  /* ---- segments ---- */
  /** The take id. One per Start, reused by a Resume. */
  sessionId: string | null;
  /** The seq of the segment currently open. */
  openSeq: number;
  /** Recorded milliseconds at which the open segment began. */
  openStartOffsetMs: number;
  /** `onstop` is a rotation, not the end of the lecture. */
  rotating: boolean;
  /** The lecture is ending: `onstop` closes the last segment and stops. */
  stopping: boolean;
  /** Closed segments whose audio this tab still holds, keyed by seq. */
  held: Map<number, HeldSegment>;
  /** Cancels the in-flight per-segment requests when the take is abandoned. */
  segmentAborts: Map<number, AbortController>;
};

const session: SessionRefs = {
  mediaRecorder: null,
  mediaStream: null,
  chunks: [],
  discard: false,
  abort: null,
  recordingMime: 'audio/webm',
  currentBodyProvider: null,
  tickTimer: null,
  recognition: null,
  captionWanted: false,
  language: undefined,
  translateTo: undefined,
  sessionId: null,
  openSeq: 1,
  openStartOffsetMs: 0,
  rotating: false,
  stopping: false,
  held: new Map(),
  segmentAborts: new Map(),
};

function stopMediaStream() {
  session.mediaStream?.getTracks().forEach((track) => track.stop());
  session.mediaStream = null;
}

function clearTickTimer() {
  if (session.tickTimer) {
    clearInterval(session.tickTimer);
    session.tickTimer = null;
  }
}

const GET_USER_MEDIA_TIMEOUT_MS = 12_000;

function getUserMediaWithTimeout(constraints: MediaStreamConstraints): Promise<MediaStream> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new DOMException('Could not start the microphone in time.', 'AbortError'));
    }, GET_USER_MEDIA_TIMEOUT_MS);
    navigator.mediaDevices.getUserMedia(constraints).then(
      (stream) => {
        if (settled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        settled = true;
        window.clearTimeout(timer);
        resolve(stream);
      },
      (error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const host = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return host.SpeechRecognition ?? host.webkitSpeechRecognition ?? null;
}

function stopCaptionStream() {
  session.captionWanted = false;
  const recognition = session.recognition;
  session.recognition = null;
  if (!recognition) return;
  recognition.onresult = null;
  recognition.onerror = null;
  recognition.onend = null;
  try {
    recognition.abort?.();
  } catch {
    try {
      recognition.stop();
    } catch {
      // already stopped
    }
  }
}

function startCaptionStream(
  set: (partial: Partial<LectureRecordingState>) => void,
  get: () => LectureRecordingState
) {
  stopCaptionStream();
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) return;
  session.captionWanted = true;
  const recognition = new Ctor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
  recognition.onresult = (event) => {
    const finals: string[] = [];
    let interim = '';
    const startIndex = typeof event.resultIndex === 'number' ? event.resultIndex : 0;
    for (let index = startIndex; index < event.results.length; index += 1) {
      const row = event.results[index];
      const piece = row?.[0]?.transcript?.trim();
      if (!piece) continue;
      if (row.isFinal) finals.push(piece);
      else interim = interim ? `${interim} ${piece}` : piece;
    }
    const merged = mergeCaptionStream({
      committed: get().committedTranscript,
      incomingFinals: finals,
      interim,
    });
    set({
      committedTranscript: merged.committed,
      interimTranscript: merged.interim,
    });
  };
  recognition.onerror = () => {
    // Captions are best-effort. The segments are the source of truth.
  };
  recognition.onend = () => {
    if (!session.captionWanted) return;
    const current = get();
    if (current.status !== 'recording' || current.pausedAt) return;
    window.setTimeout(() => {
      if (!session.captionWanted) return;
      const live = get();
      if (live.status !== 'recording' || live.pausedAt) return;
      try {
        recognition.start();
      } catch {
        // Chrome throws if start() races a restart.
      }
    }, 250);
  };
  session.recognition = recognition;
  try {
    recognition.start();
  } catch {
    // Sharing the mic with MediaRecorder can fail the first start; onend retries.
  }
}

function resetSessionState(
  set: (partial: Partial<LectureRecordingState>) => void,
  extras?: Partial<LectureRecordingState>
) {
  clearTickTimer();
  stopCaptionStream();
  session.mediaRecorder = null;
  session.chunks = [];
  session.discard = false;
  session.recordingMime = 'audio/webm';
  session.language = undefined;
  session.translateTo = undefined;
  session.rotating = false;
  session.stopping = false;
  set({
    status: 'idle',
    noteId: null,
    noteTitle: null,
    startedAt: null,
    error: null,
    tick: 0,
    pausedAt: null,
    pausedTotalMs: 0,
    ...extras,
  });
}

export function getSessionElapsedMs(
  state: Pick<LectureRecordingState, 'startedAt' | 'pausedAt' | 'pausedTotalMs'>,
  now: number = Date.now()
): number {
  return elapsedRecordingMs(
    {
      startedAt: state.startedAt,
      pausedTotalMs: state.pausedTotalMs,
      pausedAt: state.pausedAt,
    },
    now
  );
}

/** The file extension a container implies, for the segment's name. */
function extensionForMime(mimeType: string): string {
  const base = mimeType.split(';')[0] || 'audio/webm';
  if (base.includes('mp4')) return 'm4a';
  if (base.includes('ogg')) return 'ogg';
  if (base.includes('wav')) return 'wav';
  return 'webm';
}

/** Replace one segment's row, leaving the rest of the list alone. */
function patchSegment(
  set: (fn: (state: LectureRecordingState) => Partial<LectureRecordingState>) => void,
  seq: number,
  patch: Partial<LectureSegmentUi>
) {
  set((state) => ({
    segments: state.segments.map((row) => (row.seq === seq ? { ...row, ...patch } : row)),
  }));
}

/**
 * Upload one closed segment and ask for its words.
 *
 * Never awaited by the recorder: a lecture does not pause for a network round
 * trip, and a segment that fails must leave the microphone running. Everything
 * it can go wrong at is per segment — the card gets a Retry, the take does not
 * notice.
 */
/**
 * A container the transcription service cannot open.
 *
 * Rare, and browser-specific, but it used to be recoverable on the whole-take
 * path by re-encoding to WAV and trying once more. Segments must keep that:
 * without it a browser whose Opus the server cannot read would fail EVERY
 * segment of every lecture rather than one upload.
 */
function isUnreadableRecording(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  return /could not read that recording|unsupported|invalid.*media/i.test(message);
}

async function runSegment(
  set: (fn: (state: LectureRecordingState) => Partial<LectureRecordingState>) => void,
  setPartial: (partial: Partial<LectureRecordingState>) => void,
  get: () => LectureRecordingState,
  noteId: string,
  sessionId: string,
  held: HeldSegment,
  /** Set on the one automatic WAV retry, so it cannot recurse. */
  reEncoded = false
): Promise<void> {
  const controller = new AbortController();
  session.segmentAborts.set(held.seq, controller);
  set((state) => ({ inFlight: state.inFlight + 1 }));
  patchSegment(set, held.seq, { status: 'uploading', error: undefined });

  const fileName = lectureSegmentFileName(noteId, held.seq, extensionForMime(held.mimeType));
  try {
    const ticket = await notesApi.prepareLectureSegmentUpload({
      noteId,
      sessionId,
      seq: held.seq,
      startOffsetMs: held.startOffsetMs,
      durationMs: held.durationMs,
      mimeType: held.mimeType,
      byteLength: held.blob.size,
      signal: controller.signal,
    });

    // The server already has this segment's words — a resumed take re-offering
    // what it could not confirm. Uploading again would be bytes for nothing.
    if (!ticket.alreadyTranscribed) {
      await notesApi.uploadLectureSegment(held.blob, ticket, controller.signal);
    }

    patchSegment(set, held.seq, {
      status: 'transcribing',
      attachmentId: ticket.attachmentId ?? undefined,
      fileName: ticket.fileName,
    });

    const result = await notesApi.transcribeLectureSegment({
      noteId,
      sessionId,
      seq: held.seq,
      startOffsetMs: held.startOffsetMs,
      durationMs: held.durationMs,
      storagePath: ticket.storagePath,
      mimeType: ticket.mimeType,
      fileName: ticket.fileName || fileName,
      byteLength: held.blob.size,
      language: session.language,
      translateTo: session.translateTo,
      signal: controller.signal,
    });

    patchSegment(set, held.seq, {
      status: 'done',
      transcript: (result.transcript ?? '').trim(),
      error: undefined,
    });
    // The words are on the server; this tab no longer needs the audio.
    session.held.delete(held.seq);

    if (typeof result.transcriptText === 'string' && get().transcriptNoteId === noteId) {
      setPartial({ whisperTranscript: result.transcriptText });
    }
    if (result.note) {
      /**
       * Merge the note's own fields, and nothing else.
       *
       * The updated note comes back WITHOUT its attachments, so spreading it
       * over the selected note used to be able to blank the list the Audio tab
       * reads. The segment rows this store keeps are that tab's source while a
       * take is running, so there is nothing here that needs them.
       */
      const notesState = useNotesStore.getState();
      const patch = result.note;
      notesState.setNotes(
        notesState.notes.map((row) => (row.id === noteId ? { ...row, ...patch } : row))
      );
      if (notesState.selectedNote?.id === noteId) {
        notesState.setSelectedNote({
          ...notesState.selectedNote,
          ...patch,
          attachments: notesState.selectedNote.attachments,
        });
      }
    }
    if (result.persistWarning) {
      useToastStore.getState().showToast(result.persistWarning, 'info');
    }
    void fetchAIUsage();
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      patchSegment(set, held.seq, { status: 'failed', error: 'Cancelled.' });
    } else if (!reEncoded && isUnreadableRecording(error) && !held.mimeType.includes('wav')) {
      // One automatic retry as WAV, at the same seq — so the server still sees
      // one segment and still charges for it once.
      try {
        const wav = await encodeBlobAsWav(held.blob);
        const reHeld: HeldSegment = { ...held, blob: wav, mimeType: 'audio/wav' };
        session.held.set(held.seq, reHeld);
        void runSegment(set, setPartial, get, noteId, sessionId, reHeld, true);
      } catch {
        patchSegment(set, held.seq, {
          status: 'failed',
          error: 'This browser recorded audio the transcriber could not read.',
        });
      }
    } else {
      const message =
        error instanceof Error ? error.message : 'Could not transcribe this part of the lecture.';
      patchSegment(set, held.seq, {
        status: 'failed',
        error: `${message}${formatTranscribeDiag({
          blobSize: held.blob.size,
          mimeType: held.mimeType,
          durationMs: held.durationMs,
        })}`,
      });
    }
  } finally {
    session.segmentAborts.delete(held.seq);
    set((state) => ({ inFlight: Math.max(0, state.inFlight - 1) }));
    settleIfFinished(setPartial, get);
  }
}

/**
 * The end of "Saving your recording…".
 *
 * The lecture is over when the microphone is down AND nothing is in flight.
 * Only then does the studio go back to idle and offer to enhance.
 */
function settleIfFinished(
  setPartial: (partial: Partial<LectureRecordingState>) => void,
  get: () => LectureRecordingState
) {
  const state = get();
  if (state.status !== 'saving' || state.inFlight > 0) return;
  const failed = state.segments.filter((row) => row.status === 'failed').length;
  resetSessionState(setPartial, { status: 'idle' });
  if (failed > 0) {
    useToastStore
      .getState()
      .showToast(
        `${failed} part${failed === 1 ? '' : 's'} of the lecture did not transcribe. The audio is saved — tap Retry on ${failed === 1 ? 'it' : 'them'}.`,
        'error'
      );
    return;
  }
  useToastStore.getState().showToast('Transcript ready', 'success');
}

export const useLectureRecordingStore = create<LectureRecordingState>((set, get) => {
  /** Zustand's `set` in its two shapes, so helpers can take whichever they need. */
  const setPartial = (partial: Partial<LectureRecordingState>) => set(partial);

  /**
   * Build a `MediaRecorder` on the live stream and start it.
   *
   * Called once at Start and again at every rotation. The STREAM is not rebuilt
   * — reopening the microphone every five minutes would re-prompt on some
   * browsers, drop a second of audio and reset the input gain. Only the encoder
   * is replaced, which is what makes each segment a standalone file.
   */
  const armRecorder = (stream: MediaStream): MediaRecorder => {
    const mimeCandidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
    ];
    const supportedMime =
      typeof MediaRecorder.isTypeSupported === 'function'
        ? mimeCandidates.find((type) => MediaRecorder.isTypeSupported(type)) || ''
        : '';
    // Speech, not music. See @lantern/shared/utils/lectureAudio: both platforms
    // record at the same rate, so a lecture that fits on the phone fits here.
    const recorderOptions: MediaRecorderOptions = {
      audioBitsPerSecond: LECTURE_AUDIO_BITS_PER_SECOND,
    };
    const recorder = supportedMime
      ? new MediaRecorder(stream, { ...recorderOptions, mimeType: supportedMime })
      : new MediaRecorder(stream, recorderOptions);
    session.recordingMime = recorder.mimeType || supportedMime || 'audio/webm';
    session.chunks = [];

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) session.chunks.push(event.data);
    };
    recorder.onerror = () => {
      useToastStore.getState().showToast('Recording failed. Please try again.', 'error');
      stopMediaStream();
      resetSessionState(setPartial);
    };
    recorder.onstop = () => {
      void handleRecorderStop();
    };
    session.mediaRecorder = recorder;
    recorder.start(250);
    return recorder;
  };

  /**
   * One segment has closed. Hold its audio, start it on its way, and either
   * arm the next segment or end the lecture.
   */
  const handleRecorderStop = async () => {
    const state = get();
    const noteId = state.noteId;
    const sessionId = session.sessionId;
    const rotating = session.rotating;
    session.rotating = false;

    if (session.discard) {
      session.discard = false;
      session.chunks = [];
      stopMediaStream();
      resetSessionState(setPartial, {
        committedTranscript: '',
        interimTranscript: '',
        whisperTranscript: '',
        transcriptNoteId: null,
        sessionId: null,
        segments: [],
        inFlight: 0,
      });
      return;
    }

    await waitForRecorderChunks(() => session.chunks);
    const mimeType = session.recordingMime;
    const blob = new Blob(session.chunks, { type: mimeType });
    session.chunks = [];

    const seq = session.openSeq;
    const startOffsetMs = session.openStartOffsetMs;
    const closedAtMs = getSessionElapsedMs(state);
    const durationMs = Math.max(0, closedAtMs - startOffsetMs);

    if (rotating && session.mediaStream) {
      // Arm the next segment FIRST: every millisecond between the two encoders
      // is a millisecond of the lecture nobody hears again.
      session.openSeq = seq + 1;
      session.openStartOffsetMs = closedAtMs;
      armRecorder(session.mediaStream);
      // The captions belong to the segment that just closed. Whisper is about
      // to say what was in it properly, so the placeholder goes now rather
      // than lingering under the next segment's card.
      setPartial({ committedTranscript: '', interimTranscript: '' });
    } else {
      stopMediaStream();
      session.mediaRecorder = null;
      session.stopping = false;
    }

    const worthKeeping = blob.size >= 512 && durationMs >= 500;
    if (noteId && sessionId && worthKeeping) {
      const held: HeldSegment = { blob, mimeType, seq, startOffsetMs, durationMs };
      session.held.set(seq, held);
      set((current) => ({
        segments: [
          ...current.segments.filter((row) => row.seq !== seq),
          {
            seq,
            startOffsetMs,
            durationMs,
            stamp: formatLectureSegmentStamp(startOffsetMs),
            status: 'uploading' as const,
            transcript: '',
            createdAt: new Date().toISOString(),
          },
        ].sort((a, b) => a.startOffsetMs - b.startOffsetMs || a.seq - b.seq),
      }));
      void runSegment(set, setPartial, get, noteId, sessionId, held);
    }

    if (!rotating) {
      if (!noteId) {
        resetSessionState(setPartial);
        return;
      }
      if (!worthKeeping && get().segments.length === 0) {
        useToastStore.getState().showToast(
          `Recording was empty or too short. Hold for at least 2 seconds, then stop.${formatTranscribeDiag(
            { blobSize: blob.size, mimeType, durationMs }
          )}`,
          'error'
        );
        resetSessionState(setPartial);
        return;
      }
      setPartial({ status: 'saving', interimTranscript: '' });
      settleIfFinished(setPartial, get);
    }
  };

  /** The rotation itself: stop the encoder and let `onstop` do the rest. */
  const rotateSegment = () => {
    const recorder = session.mediaRecorder;
    if (!recorder || recorder.state !== 'recording') return;
    session.rotating = true;
    try {
      recorder.stop();
    } catch {
      session.rotating = false;
    }
  };

  return {
    status: 'idle',
    noteId: null,
    noteTitle: null,
    startedAt: null,
    error: null,
    tick: 0,
    pausedAt: null,
    pausedTotalMs: 0,
    committedTranscript: '',
    interimTranscript: '',
    whisperTranscript: '',
    transcriptNoteId: null,
    sessionId: null,
    segments: [],
    inFlight: 0,

    setCurrentBodyProvider: (provider) => {
      session.currentBodyProvider = provider;
    },

    isActiveForNote: (noteId) => {
      const { noteId: activeId, status } = get();
      return Boolean(activeId === noteId && status !== 'idle');
    },

    isBusy: () => get().status !== 'idle',

    /**
     * Read the note's own segment rows.
     *
     * This is what makes a crash recoverable: the rows were written before the
     * audio was transcribed, so a tab that died mid-lecture left a trail on the
     * server. Never called while a take is running — the live list is the truth
     * then, and the server's copy lags it by a round trip.
     */
    hydrateFromNote: (noteId, attachments) => {
      if (get().status !== 'idle') return;
      const rows: LectureSegmentRow[] = lectureSegmentRows(
        (attachments ?? []) as Parameters<typeof lectureSegmentRows>[0]
      );
      const decision = resolveLectureResume({ rows });
      if (decision.action === 'none' && rows.length === 0) {
        set({ segments: [], sessionId: null });
        return;
      }
      const sessionId = decision.action === 'none' ? null : decision.sessionId;
      const ofSession = sessionId ? rows.filter((row) => row.sessionId === sessionId) : rows;
      set({
        sessionId,
        transcriptNoteId: noteId,
        segments: ofSession.map((row) => ({
          seq: row.seq,
          startOffsetMs: row.startOffsetMs,
          durationMs: row.durationMs,
          stamp: formatLectureSegmentStamp(row.startOffsetMs),
          status: row.status === 'done' && row.transcript ? 'done' : 'failed',
          transcript: row.transcript,
          error:
            row.status === 'done' && row.transcript
              ? undefined
              : 'This part was recorded but never transcribed.',
          attachmentId: row.attachmentId,
          fileName: row.fileName,
          fileUrl: row.fileUrl,
          createdAt: row.createdAt,
          fromServer: true,
        })),
      });
    },

    start: async (noteId, noteTitle, options) => {
      const current = get();
      if (current.status === 'recording') {
        if (current.noteId === noteId) return;
        useToastStore
          .getState()
          .showToast('A lecture is already recording. Stop or discard it first.', 'info');
        return;
      }
      if (current.status !== 'idle') {
        useToastStore.getState().showToast('Wait for the recording to finish saving.', 'info');
        return;
      }

      if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        useToastStore
          .getState()
          .showToast('Audio recording is not supported in this browser. Try Chrome or Edge.', 'error');
        return;
      }

      try {
        session.discard = false;
        session.chunks = [];
        session.rotating = false;
        session.stopping = false;
        session.language = options?.language;
        session.translateTo = options?.translateTo;
        const deviceId = options?.deviceId;
        const stream = await getUserMediaWithTimeout({
          audio: {
            // The pre-check panel's picker. `ideal` rather than `exact`: a
            // microphone unplugged between the pre-check and Start must fall
            // back to the default, not throw OverconstrainedError at a student
            // standing in a lecture.
            ...(deviceId ? { deviceId: { ideal: deviceId } } : {}),
            echoCancellation: true,
            noiseSuppression: true,
            channelCount: LECTURE_AUDIO_CHANNELS,
            // A hint, not a guarantee — browsers are free to ignore it. The
            // bitrate is what actually bounds the file size.
            sampleRate: LECTURE_AUDIO_SAMPLE_RATE_HZ,
          },
        });
        session.mediaStream = stream;

        /**
         * A resume carries on the SAME take: the same `sessionId`, the next
         * free `seq`, and a clock wound back to where the interrupted take
         * stopped, so segment 7's stamp is where minute 30 really was. A fresh
         * Start gets a new take and a clock at zero.
         */
        const resume = options?.resume;
        session.sessionId = resume?.sessionId ?? newLectureSessionId();
        session.openSeq = resume?.nextSeq ?? 1;
        session.openStartOffsetMs = resume?.recordedMs ?? 0;
        session.held.clear();
        session.segmentAborts.clear();

        const sameNote = get().transcriptNoteId === noteId;
        const startedAt = Date.now() - (resume?.recordedMs ?? 0);
        armRecorder(stream);

        clearTickTimer();
        session.tickTimer = setInterval(() => {
          set({ tick: Date.now() });
          const live = get();
          if (live.status !== 'recording' || live.pausedAt) return;
          // Rotation is driven by RECORDED time, so a lecture paused for ten
          // minutes does not close a segment while nothing is being captured.
          const openMs = getSessionElapsedMs(live) - session.openStartOffsetMs;
          if (shouldRotateLectureSegment(openMs)) rotateSegment();
        }, 1000);

        set({
          status: 'recording',
          noteId,
          noteTitle,
          startedAt,
          error: null,
          tick: startedAt,
          pausedAt: null,
          pausedTotalMs: 0,
          committedTranscript: '',
          interimTranscript: '',
          whisperTranscript: sameNote ? get().whisperTranscript : '',
          transcriptNoteId: noteId,
          sessionId: session.sessionId,
          segments: resume ? get().segments : [],
          inFlight: 0,
        });
        startCaptionStream(set, get);
        if (options?.currentBody !== undefined) {
          // no-op; body provider preferred
        }
      } catch (err: unknown) {
        stopMediaStream();
        const name = err instanceof DOMException ? err.name : '';
        const message =
          name === 'NotAllowedError' || name === 'PermissionDeniedError'
            ? 'Microphone permission is blocked. Allow mic access for lanternstudy.com, then retry.'
            : name === 'NotFoundError'
              ? 'No microphone found. Plug in a mic and try again.'
              : name === 'AbortError' || /timed out/i.test(err instanceof Error ? err.message : '')
                ? 'Could not start the microphone in time. Click Start again.'
                : 'Microphone access is required to record lectures.';
        useToastStore.getState().showToast(message, 'error');
        resetSessionState(setPartial, { error: message });
      }
    },

    stopAndTranscribe: () => {
      const current = get();
      if (current.status !== 'recording') return;
      const recorder = session.mediaRecorder;
      if (!recorder) return;
      const elapsed = getSessionElapsedMs(current);
      // Only a take with nothing banked can be too short: once a segment has
      // landed, the lecture happened, however briefly the last piece ran.
      if (elapsed < MIN_LECTURE_RECORD_MS && current.segments.length === 0) {
        useToastStore
          .getState()
          .showToast('Keep recording for at least 2 seconds so we can capture audio.', 'info');
        return;
      }
      session.discard = false;
      session.rotating = false;
      session.stopping = true;
      stopCaptionStream();
      clearTickTimer();
      try {
        if (recorder.state === 'recording' || recorder.state === 'paused') {
          recorder.stop();
        }
      } catch {
        // ignore
      }
      // `onstop` closes the last segment and moves to "Saving your recording…".
    },

    pauseRecording: () => {
      const current = get();
      if (current.status !== 'recording' || current.pausedAt) return;
      const recorder = session.mediaRecorder;
      if (!recorder || recorder.state !== 'recording') return;
      try {
        recorder.pause();
        stopCaptionStream();
        set({ pausedAt: Date.now(), tick: Date.now() });
      } catch {
        useToastStore.getState().showToast('Could not pause. Still recording.', 'info');
      }
    },

    resumeRecording: () => {
      const current = get();
      if (current.status !== 'recording' || !current.pausedAt) return;
      const recorder = session.mediaRecorder;
      if (!recorder || recorder.state !== 'paused') return;
      try {
        recorder.resume();
        set({
          pausedAt: null,
          pausedTotalMs: pausedTotalAfterResume(current.pausedTotalMs, current.pausedAt),
          tick: Date.now(),
        });
        startCaptionStream(set, get);
      } catch {
        useToastStore
          .getState()
          .showToast('Could not resume. Stop to keep what you have already recorded.', 'error');
      }
    },

    /**
     * Transcribe one segment again.
     *
     * Two doors, because the audio can be in either place. This tab may still
     * hold the blob (a transcription that failed while the lecture ran), in
     * which case the whole prepare/upload/transcribe run happens again and the
     * server recognises the segment and charges nothing extra. Or the tab has
     * let it go and the row is all there is — then the audio is already in
     * storage and only the words are missing, which is what a reload's Retry
     * acts on.
     */
    retrySegment: (seq) => {
      const state = get();
      const noteId = state.noteId ?? state.transcriptNoteId;
      const sessionId = state.sessionId;
      if (!noteId || !sessionId) return;
      const row = state.segments.find((item) => item.seq === seq);
      if (!row || row.status === 'done') return;

      const held = session.held.get(seq);
      if (held) {
        void runSegment(set, setPartial, get, noteId, sessionId, held);
        return;
      }
      // Nothing local left: ask the server to transcribe what it already holds.
      void (async () => {
        set((current) => ({ inFlight: current.inFlight + 1 }));
        patchSegment(set, seq, { status: 'transcribing', error: undefined });
        try {
          const ticket = await notesApi.prepareLectureSegmentUpload({
            noteId,
            sessionId,
            seq,
            startOffsetMs: row.startOffsetMs,
            durationMs: row.durationMs,
            mimeType: 'audio/webm',
            byteLength: 0,
          });
          const result = await notesApi.transcribeLectureSegment({
            noteId,
            sessionId,
            seq,
            startOffsetMs: row.startOffsetMs,
            durationMs: row.durationMs,
            storagePath: ticket.storagePath,
            mimeType: ticket.mimeType,
            fileName: ticket.fileName,
            byteLength: 0,
            language: session.language,
            translateTo: session.translateTo,
          });
          patchSegment(set, seq, {
            status: 'done',
            transcript: (result.transcript ?? '').trim(),
            error: undefined,
          });
          if (typeof result.transcriptText === 'string') {
            setPartial({ whisperTranscript: result.transcriptText });
          }
          void fetchAIUsage();
        } catch (error: unknown) {
          patchSegment(set, seq, {
            status: 'failed',
            error:
              error instanceof Error
                ? error.message
                : 'Could not transcribe this part of the lecture.',
          });
        } finally {
          set((current) => ({ inFlight: Math.max(0, current.inFlight - 1) }));
          settleIfFinished(setPartial, get);
        }
      })();
    },

    discard: () => {
      const { status } = get();
      const clearAll = {
        committedTranscript: '',
        interimTranscript: '',
        whisperTranscript: '',
        transcriptNoteId: null,
        sessionId: null,
        segments: [],
        inFlight: 0,
      };
      // Segments already transcribed are IN THE NOTE and were paid for. Discard
      // ends the take and drops what this tab is still holding; it does not
      // reach back into the note, which is the student's to edit.
      session.segmentAborts.forEach((controller) => controller.abort());
      session.segmentAborts.clear();
      session.held.clear();
      session.sessionId = null;

      if (status === 'uploading' || status === 'transcribing' || status === 'saving') {
        session.abort?.abort();
        session.abort = null;
        resetSessionState(setPartial, clearAll);
        return;
      }
      if (status !== 'recording') {
        resetSessionState(setPartial, clearAll);
        return;
      }
      session.discard = true;
      const recorder = session.mediaRecorder;
      session.mediaRecorder = null;
      session.chunks = [];
      stopCaptionStream();
      clearTickTimer();
      try {
        if (recorder && (recorder.state === 'recording' || recorder.state === 'paused')) {
          recorder.stop();
        } else {
          stopMediaStream();
          resetSessionState(setPartial, clearAll);
        }
      } catch {
        stopMediaStream();
        resetSessionState(setPartial, clearAll);
      }
    },

    cancelTranscription: () => {
      session.segmentAborts.forEach((controller) => controller.abort());
      session.segmentAborts.clear();
      session.abort?.abort();
      session.abort = null;
      resetSessionState(setPartial, { inFlight: 0 });
    },
  };
});

export function isLectureRecordingActive(): boolean {
  return useLectureRecordingStore.getState().status !== 'idle';
}
