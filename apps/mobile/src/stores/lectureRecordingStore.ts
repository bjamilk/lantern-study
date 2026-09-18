/**
 * The one lecture recording in flight, app-wide: capture, pause/resume, the
 * naming step, upload and transcription into a note.
 *
 * A single global session on purpose — the clock, the audio file and the
 * foreground service must outlive the screen that started them, and two
 * concurrent recordings would fight over the microphone.
 *
 * Main exports: `useLectureRecordingStore` (`start`, `pauseRecording`,
 * `resumeRecording`, `stopForTitle`, `confirmTitleAndTranscribe`,
 * `retryTranscription`, `discard`, `cancelTranscription`,
 * `refreshMicPermission`, `isActiveForNote`) and `LectureRecordingStatus`.
 *
 * Touches: expo-av (Audio.Recording, imported lazily), expo-file-system/legacy
 * for the audio file, expo-keep-awake, the native lecture-recording-service
 * (Android foreground service + notification), react-native AppState,
 * services/notes (the per-segment prepare/upload/transcribe), services/liveSpeech for live
 * captions, services/ai (`fetchAIUsage`), plus notesStore and toastStore.
 *
 * Segmented since W4: every LECTURE_SEGMENT_MS the recorder is stopped and a
 * NEW `Audio.Recording` is started, so each closed segment is a standalone
 * file that is uploaded and transcribed WHILE the lecture runs. On Android the
 * app being killed mid-lecture is routine rather than exceptional, so the old
 * "one cache file, uploaded after Stop" shape meant a killed app lost the
 * whole take. It now loses at most the five minutes still open. The naming
 * sheet is unchanged and still gates the FINAL segment.
 *
 * Gotchas: the status machine is load-bearing. `naming` is the only point
 * where nothing has been spent yet, and `failed` HOLDS the audio file so
 * `retryTranscription` can reuse it — only `discard` deletes it. `pendingUri`
 * (waiting for a title) and `failedUri` (held after a failure) are separate
 * refs so a double tap cannot start two uploads. Resume reopens the SAME file,
 * so a lecture is one recording; paused time is tracked in `pausedTotalMs` and
 * never billed. Mutable handles live in a module-level `SessionRefs` object
 * rather than in store state, so they are process-global and not user-scoped.
 */
import { create } from 'zustand';
import { AppState, type AppStateStatus } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
// The SUBPATH, not the bare package: mobile's jest maps
// `@lantern/shared/<subpath>` but not `@lantern/shared` itself, so a bare
// import makes this store impossible to load in a test at all.
import { composeLectureNoteBody, displayLectureTranscript } from '@lantern/shared/learning';
import {
  maxLectureRecordingMs,
  normalizeLectureSpokenLanguage,
  normalizeLectureTranscribeTarget,
} from '@lantern/shared/utils/lectureAudio';
import {
  formatLectureSegmentStamp,
  lectureSegmentRows,
  newLectureSessionId,
  resolveLectureResume,
  shouldRotateLectureSegment,
  type LectureSegmentAttachmentLike,
  type LectureSegmentRow,
} from '@lantern/shared/utils/lectureSegments';
import { startLiveCaptionStream } from '../services/liveSpeech';
import { fetchAIUsage } from '../services/ai';
import {
  prepareLectureSegmentUpload,
  transcribeLectureSegment,
  uploadLectureSegment,
} from '../services/notes';
import { useSettingsStore } from './settingsStore';
import {
  hasLectureForegroundService,
  startLectureForegroundService,
  stopLectureForegroundService,
} from '../../modules/lecture-recording-service';
import { useNotesStore } from './notesStore';
import { useToastStore } from './toastStore';
import {
  planTitleAtStop,
  suggestedLectureTitle,
  type MicPermissionState,
} from '../components/lecture/lecturePreflight';
import { speechRecordingOptions } from '../components/lecture/lectureAudioPreset';
import {
  planRecordingNotification,
  type NotificationStatus,
} from '../components/lecture/lectureNotification';
import {
  elapsedRecordingMs,
  pausedTotalAfterResume,
} from '../components/lecture/recordingClock';

/**
 * `naming` sits between the recorder stopping and the upload starting: the
 * audio is on disk and nothing has been spent yet, so this is the one moment
 * where asking "what was this lecture?" costs the student nothing.
 *
 * `failed` is the state this store used to be missing. A transcription that
 * failed — an airplane-mode toggle mid-upload, a 500, a timeout — used to run
 * `resetSession` in a `finally`, which dropped the URI on the floor: the audio
 * file stayed in the cache with nothing pointing at it, and the lecture the
 * student had just sat through was gone. Now the file is HELD, `Retry
 * transcription` is offered, and Discard is the only thing that deletes it.
 */
/**
 * The two language choices, read off the synced settings blob.
 *
 * Returns the wire shape rather than the setting shape so the call site reads
 * as one spread; `normalize*` runs on the way out because a blob written by a
 * newer build must not reach Whisper unchecked.
 */
function lectureTranscribeLanguages(): { language: string; translateTo: string } {
  const lecture = useSettingsStore.getState().settings?.lecture;
  return {
    language: normalizeLectureSpokenLanguage(lecture?.spokenLanguage),
    translateTo: normalizeLectureTranscribeTarget(lecture?.transcribeTo),
  };
}

export type LectureRecordingStatus =
  | 'idle'
  | 'recording'
  | 'naming'
  | 'uploading'
  | 'transcribing'
  | 'failed';

const MIN_LECTURE_RECORD_MS = 2000;

/** How often the recorder reports a level. Fast enough to look live, cheap. */
const METERING_INTERVAL_MS = 250;

/**
 * The point at which a recording no longer fits under the server's byte cap.
 * Derived from the preset's bitrate, never typed — see
 * `@lantern/shared/utils/lectureAudio`.
 */
const MAX_RECORDING_MS = maxLectureRecordingMs();

type RecordingHandle = {
  stopAndUnloadAsync: () => Promise<void>;
  getURI: () => string | null;
  /** `expo-av` resumes into the SAME file, which is what makes Resume append. */
  pauseAsync: () => Promise<unknown>;
  startAsync: () => Promise<unknown>;
};

type ExpoAudioModule = typeof import('expo-av').Audio;

interface LectureRecordingState {
  status: LectureRecordingStatus;
  noteId: string | null;
  noteTitle: string | null;
  startedAt: number | null;
  error: string | null;
  tick: number;
  /**
   * The microphone permission as last READ from the OS — never assumed. The
   * pre-flight card refuses to say anything about the mic until this is not
   * `'unknown'`.
   */
  micPermission: MicPermissionState;
  /** Latest metering reading in dBFS, or `null` before the first one lands. */
  meterDb: number | null;
  /** What the title sheet is prefilled with while `status === 'naming'`. */
  pendingTitleSuggestion: string | null;
  /** True while `status === 'failed'` and the audio is still on disk. */
  canRetryTranscription: boolean;
  /** When the current pause began, or `null` while actually recording. */
  pausedAt: number | null;
  /** Milliseconds spent paused across the whole session. Never billed. */
  pausedTotalMs: number;
  committedTranscript: string;
  interimTranscript: string;
  whisperTranscript: string;
  transcriptNoteId: string | null;

  /** The take this store is recording or last recorded. */
  sessionId: string | null;
  /** Every segment of the open take, in recorded order. */
  segments: LectureSegmentUi[];
  /** Segments still uploading or transcribing. */
  inFlight: number;

  start: (
    noteId: string,
    noteTitle: string,
    options?: {
      currentBody?: string;
      /** Carry on an interrupted take instead of starting a new one. */
      resume?: { sessionId: string; nextSeq: number; recordedMs: number };
    }
  ) => Promise<void>;
  /** Stop the recorder and open the title sheet. Nothing is uploaded yet. */
  stopForTitle: (options?: { currentBody?: string }) => Promise<void>;
  /** Accept the sheet's title (empty keeps the suggestion) and transcribe. */
  confirmTitleAndTranscribe: (typedTitle?: string) => Promise<void>;
  /** Stop capturing without ending the lecture. The file stays open. */
  pauseRecording: () => Promise<void>;
  /** Carry on into the SAME file, so the lecture is one recording, not two. */
  resumeRecording: () => Promise<void>;
  /** Upload the held recording again. Spends nothing until the upload lands. */
  retryTranscription: () => Promise<void>;
  /** Read the OS microphone permission without asking for it. */
  refreshMicPermission: () => Promise<void>;
  discard: () => Promise<void>;
  cancelTranscription: () => void;
  /** Transcribe one segment again. Its audio is already safe. */
  retrySegment: (seq: number) => Promise<void>;
  /** Read the note's own segment rows so a reload can offer to carry on. */
  hydrateFromNote: (
    noteId: string,
    attachments: readonly LectureSegmentAttachmentLike[] | null | undefined
  ) => void;
  setCurrentBodyProvider: (provider: (() => string) | null) => void;
  isActiveForNote: (noteId: string) => boolean;
}

export type LectureSegmentUiStatus = 'uploading' | 'transcribing' | 'done' | 'failed';

/** One card in the transcript list, and one row in the Audio files list. */
export interface LectureSegmentUi {
  seq: number;
  startOffsetMs: number;
  durationMs: number;
  /** `0:00`, `5:00`, `1:05:00` — the gutter time on the card. */
  stamp: string;
  status: LectureSegmentUiStatus;
  transcript: string;
  error?: string;
  attachmentId?: string;
  fileName?: string;
  fileUrl?: string;
  createdAt?: string;
}

/** The audio of one closed segment, held on disk until the server has its words. */
type HeldSegment = {
  uri: string;
  seq: number;
  startOffsetMs: number;
  durationMs: number;
};

type SessionRefs = {
  recording: RecordingHandle | null;
  abort: AbortController | null;
  currentBodyProvider: (() => string) | null;
  tickTimer: ReturnType<typeof setInterval> | null;
  appStateSub: { remove: () => void } | null;
  AudioMod: ExpoAudioModule | null;
  /** Set while `status === 'naming'`: the stopped file waiting for a title. */
  pendingUri: string | null;
  pendingElapsedMs: number;
  pendingBody: string | undefined;
  /**
   * The file a FAILED transcription is still holding. Separate from
   * `pendingUri` on purpose: `pendingUri` is cleared the instant the upload
   * begins so a double tap cannot start two, and this is what survives the
   * failure.
   */
  failedUri: string | null;
  /** Whether the notification/service is currently up, so it is not re-issued. */
  serviceRunning: boolean;
  /** Whether the screen lock is currently held. */
  keepAwake: boolean;
  stopCaptions: (() => void) | null;
  captionPersistTimer: ReturnType<typeof setTimeout> | null;

  /* ---- segments ---- */
  /** The take id. One per Start, reused by a Resume. */
  sessionId: string | null;
  /** The seq of the segment currently open. */
  openSeq: number;
  /** Recorded milliseconds at which the open segment began. */
  openStartOffsetMs: number;
  /** True while a rotation is in flight, so two cannot overlap. */
  rotating: boolean;
  /** Closed segments whose audio is still on this phone, keyed by seq. */
  held: Map<number, HeldSegment>;
};

const session: SessionRefs = {
  recording: null,
  abort: null,
  currentBodyProvider: null,
  tickTimer: null,
  appStateSub: null,
  AudioMod: null,
  pendingUri: null,
  pendingElapsedMs: 0,
  pendingBody: undefined,
  failedUri: null,
  serviceRunning: false,
  keepAwake: false,
  stopCaptions: null,
  captionPersistTimer: null,
  sessionId: null,
  openSeq: 1,
  openStartOffsetMs: 0,
  rotating: false,
  held: new Map(),
};

const KEEP_AWAKE_TAG = 'lecture-recording';

function clearTickTimer() {
  if (session.tickTimer) {
    clearInterval(session.tickTimer);
    session.tickTimer = null;
  }
}

function clearAppStateSub() {
  session.appStateSub?.remove();
  session.appStateSub = null;
}

function stopCaptionStream() {
  if (session.captionPersistTimer) {
    clearTimeout(session.captionPersistTimer);
    session.captionPersistTimer = null;
  }
  const stop = session.stopCaptions;
  session.stopCaptions = null;
  stop?.();
}

function persistLiveCaptions(get: () => LectureRecordingState) {
  const state = get();
  if (!state.noteId) return;
  const display = displayLectureTranscript({
    committed: state.committedTranscript,
    interim: state.interimTranscript,
    whisper: state.whisperTranscript,
  });
  if (!display.trim()) return;
  const typed = session.currentBodyProvider?.() ?? '';
  void useNotesStore
    .getState()
    .saveNote(state.noteId, { body: composeLectureNoteBody(typed, display) })
    .catch(() => undefined);
}

function startCaptionStream(
  set: (partial: Partial<LectureRecordingState>) => void,
  get: () => LectureRecordingState
) {
  stopCaptionStream();
  void startLiveCaptionStream({
    getCommitted: () => get().committedTranscript,
    onUpdate: (next) => {
      set({
        committedTranscript: next.committed,
        interimTranscript: next.interim,
      });
      if (session.captionPersistTimer) clearTimeout(session.captionPersistTimer);
      session.captionPersistTimer = setTimeout(() => persistLiveCaptions(get), 800);
    },
  }).then((stop) => {
    if (!stop) return;
    if (get().status !== 'recording' || get().pausedAt) {
      stop();
      return;
    }
    session.stopCaptions = stop;
  });
}

/**
 * The notification and the wake lock follow the microphone, and they are put
 * down from ONE place so no exit path can leave either behind. A notification
 * that outlives its recording is a lie about an open microphone.
 */
function applyRecordingSideEffects(status: NotificationStatus, noteTitle: string | null) {
  const plan = planRecordingNotification(status, noteTitle);
  if (plan.visible) {
    if (!session.serviceRunning) {
      session.serviceRunning = startLectureForegroundService(plan.title, plan.body);
    }
    if (!session.keepAwake) {
      session.keepAwake = true;
      // Belt and braces beside the foreground service: on a build without the
      // service this is the only thing keeping the recording alive, and even
      // with it, a student watching the timer should not have the screen die.
      void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {
        session.keepAwake = false;
      });
    }
    return;
  }
  if (session.serviceRunning) {
    stopLectureForegroundService();
    session.serviceRunning = false;
  }
  if (session.keepAwake) {
    session.keepAwake = false;
    try {
      deactivateKeepAwake(KEEP_AWAKE_TAG);
    } catch {
      // Nothing to do: the lock is released when the app backgrounds anyway.
    }
  }
}

async function resetAudioMode() {
  try {
    const AudioMod = session.AudioMod ?? (await import('expo-av')).Audio;
    await AudioMod.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      playThroughEarpieceAndroid: false,
    });
  } catch {
    // ignore
  }
}

/** Drop a recording from the cache. Only ever called by Discard, or on success. */
async function deleteRecordingFile(uri: string | null) {
  if (!uri) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // A file we cannot delete is a wasted megabyte, not a lost lecture.
  }
}

function resetSession(
  set: (partial: Partial<LectureRecordingState>) => void,
  extras?: Partial<LectureRecordingState>
) {
  clearTickTimer();
  clearAppStateSub();
  stopCaptionStream();
  applyRecordingSideEffects('idle', null);
  session.recording = null;
  session.abort = null;
  session.pendingUri = null;
  session.pendingElapsedMs = 0;
  session.pendingBody = undefined;
  session.failedUri = null;
  set({
    status: 'idle',
    noteId: null,
    noteTitle: null,
    startedAt: null,
    error: null,
    tick: 0,
    meterDb: null,
    pendingTitleSuggestion: null,
    canRetryTranscription: false,
    pausedAt: null,
    pausedTotalMs: 0,
    ...extras,
  });
}

function captionFieldsForNote(
  state: Pick<LectureRecordingState, 'transcriptNoteId' | 'committedTranscript' | 'whisperTranscript'>,
  noteId: string
) {
  const same = state.transcriptNoteId === noteId;
  return {
    committedTranscript: same ? state.committedTranscript : '',
    interimTranscript: '',
    whisperTranscript: same ? state.whisperTranscript : '',
    transcriptNoteId: noteId,
  };
}

/**
 * The note's title as it stands right now, not as it stood when recording
 * started — the student may have renamed it mid-lecture, and the sheet must
 * not offer to undo that.
 */
function currentTitleForNote(noteId: string, fallback: string | null): string {
  const notesState = useNotesStore.getState();
  const live =
    notesState.selectedNote?.id === noteId
      ? notesState.selectedNote.title
      : notesState.notes.find((n) => n.id === noteId)?.title;
  return (live ?? fallback ?? '').trim();
}

/**
 * Kept for the call sites that only have a `startedAt`. Prefer
 * `getSessionElapsedMs`, which also subtracts paused time — a paused lecture
 * that kept billing would charge for the coffee break.
 */
export function getElapsedRecordingSeconds(startedAt: number | null): number {
  if (!startedAt) return 0;
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

/** Recorded milliseconds, pauses excluded. What the price and size read. */
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

export function formatRecordingDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Close the open segment and open the next one, without ending the lecture.
 *
 * `expo-av` has no equivalent of the browser's "same stream, new encoder": the
 * recording IS the capture, so the microphone is briefly released and
 * reacquired. That gap is why the next segment's offset is the measured close
 * time rather than a round five minutes — the stamps say where the audio
 * actually is, and the offsets stay contiguous with it.
 *
 * Guarded by `session.rotating` so a slow `createAsync` cannot let a second
 * rotation start on a recorder that is already down.
 */
async function rotateSegment(
  set: (fn: (state: LectureRecordingState) => Partial<LectureRecordingState>) => void,
  get: () => LectureRecordingState,
  noteId: string
): Promise<void> {
  if (session.rotating) return;
  const rec = session.recording;
  const AudioMod = session.AudioMod;
  const sessionId = session.sessionId;
  if (!rec || !AudioMod || !sessionId) return;
  session.rotating = true;

  const seq = session.openSeq;
  const startOffsetMs = session.openStartOffsetMs;
  try {
    const closedAtMs = getSessionElapsedMs(get());
    await rec.stopAndUnloadAsync();
    const uri = rec.getURI();
    session.recording = null;

    // Reopen FIRST: every millisecond between the two recorders is a
    // millisecond of the lecture nobody hears again.
    const { recording: next } = await AudioMod.Recording.createAsync(
      speechRecordingOptions(AudioMod.RecordingOptionsPresets.HIGH_QUALITY) as Parameters<
        typeof AudioMod.Recording.createAsync
      >[0],
      (recStatus: { metering?: number }) => {
        const db = typeof recStatus?.metering === 'number' ? recStatus.metering : null;
        set(() => ({ meterDb: db !== null && Number.isFinite(db) ? db : null }));
      },
      METERING_INTERVAL_MS
    );
    session.recording = next as unknown as RecordingHandle;
    session.openSeq = seq + 1;
    session.openStartOffsetMs = closedAtMs;

    if (uri) {
      const held: HeldSegment = {
        uri,
        seq,
        startOffsetMs,
        durationMs: Math.max(0, closedAtMs - startOffsetMs),
      };
      session.held.set(seq, held);
      set((state) => ({
        segments: [
          ...state.segments.filter((row) => row.seq !== seq),
          {
            seq,
            startOffsetMs,
            durationMs: held.durationMs,
            stamp: formatLectureSegmentStamp(startOffsetMs),
            status: 'uploading' as const,
            transcript: '',
            createdAt: new Date().toISOString(),
          },
        ].sort((a, b) => a.startOffsetMs - b.startOffsetMs || a.seq - b.seq),
        // The captions belong to the segment that just closed; Whisper is about
        // to say what was in it properly.
        committedTranscript: '',
        interimTranscript: '',
      }));
      void runSegmentUpload(
        set,
        (partial) => set(() => partial),
        get,
        noteId,
        sessionId,
        held
      );
    }
  } catch {
    // The recorder would not restart. Say so plainly and end the take rather
    // than pretend a microphone is open that is not.
    useToastStore
      .getState()
      .showToast('Recording stopped unexpectedly. What you have so far is saved.', 'error');
    void get().stopForTitle();
  } finally {
    session.rotating = false;
  }
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

/** The MIME and extension a cache file's name implies. */
function mimeForUri(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.webm')) return 'audio/webm';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  return 'audio/mp4';
}

/**
 * Upload one closed segment and ask for its words.
 *
 * Never awaited by the recorder: the lecture does not pause for a round trip
 * on a phone with two bars of signal, and a segment that fails must leave the
 * microphone running. The cache file is deleted ONLY once the server has the
 * words — a failure keeps it, which is what the per-segment Retry uses.
 */
async function runSegmentUpload(
  set: (fn: (state: LectureRecordingState) => Partial<LectureRecordingState>) => void,
  setPartial: (partial: Partial<LectureRecordingState>) => void,
  get: () => LectureRecordingState,
  noteId: string,
  sessionId: string,
  held: HeldSegment
): Promise<void> {
  set((state) => ({ inFlight: state.inFlight + 1 }));
  patchSegment(set, held.seq, { status: 'uploading', error: undefined });
  const mimeType = mimeForUri(held.uri);

  try {
    const info = await FileSystem.getInfoAsync(held.uri);
    const byteLength = info.exists && 'size' in info ? Number(info.size) || 0 : 0;

    const ticket = await prepareLectureSegmentUpload({
      noteId,
      sessionId,
      seq: held.seq,
      startOffsetMs: held.startOffsetMs,
      durationMs: held.durationMs,
      mimeType,
      byteLength,
    });

    // The server already has this segment's words — a resumed take re-offering
    // what it could not confirm. Uploading again would be data for nothing,
    // which on a student's phone plan is not a rounding error.
    if (!ticket.alreadyTranscribed) {
      await uploadLectureSegment(held.uri, ticket);
    }

    patchSegment(set, held.seq, {
      status: 'transcribing',
      attachmentId: ticket.attachmentId ?? undefined,
      fileName: ticket.fileName,
    });

    const result = await transcribeLectureSegment({
      noteId,
      sessionId,
      seq: held.seq,
      startOffsetMs: held.startOffsetMs,
      durationMs: held.durationMs,
      storagePath: ticket.storagePath,
      mimeType: ticket.mimeType,
      fileName: ticket.fileName,
      byteLength,
      // Read HERE rather than captured at start: a failed segment keeps its
      // file and offers a retry, and a student who retries after fixing the
      // language in settings should get the language they fixed.
      ...lectureTranscribeLanguages(),
    });

    patchSegment(set, held.seq, {
      status: 'done',
      transcript: (result.transcript ?? '').trim(),
      error: undefined,
    });
    if (typeof result.transcriptText === 'string' && get().transcriptNoteId === noteId) {
      setPartial({ whisperTranscript: result.transcriptText });
    }
    if (result.persistWarning) {
      useToastStore.getState().showToast(result.persistWarning, 'info');
    }
    // The words are on the server; the cache copy has no reader left.
    session.held.delete(held.seq);
    await deleteRecordingFile(held.uri);
    void fetchAIUsage();
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Could not transcribe this part of the lecture.';
    patchSegment(set, held.seq, { status: 'failed', error: message });
  } finally {
    set((state) => ({ inFlight: Math.max(0, state.inFlight - 1) }));
  }
}

export const useLectureRecordingStore = create<LectureRecordingState>((set, get) => ({
  status: 'idle',
  noteId: null,
  noteTitle: null,
  startedAt: null,
  error: null,
  tick: 0,
  micPermission: 'unknown',
  meterDb: null,
  pendingTitleSuggestion: null,
  canRetryTranscription: false,
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

  /**
   * Read, do not ask. `getPermissionsAsync` is what lets the pre-flight card
   * show a mic state before a recording exists — and what lets it say
   * "Blocked" with a real next step instead of a cheerful default.
   */
  refreshMicPermission: async () => {
    try {
      const AudioMod = session.AudioMod ?? (await import('expo-av')).Audio;
      session.AudioMod = AudioMod;
      const perm = await AudioMod.getPermissionsAsync();
      const status = (perm?.status as MicPermissionState | undefined) ?? 'unknown';
      set({
        micPermission:
          status === 'granted' || status === 'denied' || status === 'undetermined'
            ? status
            : perm?.granted
              ? 'granted'
              : 'unknown',
      });
    } catch {
      set({ micPermission: 'unknown' });
    }
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
    if (current.status === 'naming') {
      // A stopped file is waiting for its title; starting another would
      // orphan it. The sheet is modal, so this is belt-and-braces.
      useToastStore.getState().showToast('Name the recording you just stopped first.', 'info');
      return;
    }
    if (current.status === 'failed') {
      useToastStore
        .getState()
        .showToast('Retry or discard the recording you already have first.', 'info');
      return;
    }
    if (current.status === 'uploading' || current.status === 'transcribing') {
      useToastStore.getState().showToast('Wait for transcription to finish.', 'info');
      return;
    }

    try {
      const { Audio: AudioMod } = await import('expo-av');
      session.AudioMod = AudioMod;
      const permission = await AudioMod.requestPermissionsAsync();
      if (!permission.granted) {
        // The card reads this the moment the answer comes back, so a denial
        // shows as "Blocked · Open settings" rather than a toast that is gone
        // by the time the student looks up.
        set({ micPermission: 'denied' });
        useToastStore
          .getState()
          .showToast('Microphone access is required to record lectures.', 'error');
        return;
      }
      set({ micPermission: 'granted', meterDb: null });
      await AudioMod.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        playThroughEarpieceAndroid: false,
      });
      // Speech, not music: mono 16 kHz at 32 kbps, so a 45-minute lecture is
      // ~11 MB instead of ~43 MB and actually clears the server's 25 MB cap.
      // `isMeteringEnabled` inside the override is what makes `status.metering`
      // real — without it the pre-flight card has a bar and no reading.
      const { recording: rec } = await AudioMod.Recording.createAsync(
        speechRecordingOptions(AudioMod.RecordingOptionsPresets.HIGH_QUALITY) as Parameters<
          typeof AudioMod.Recording.createAsync
        >[0],
        (recStatus) => {
          const db = typeof recStatus?.metering === 'number' ? recStatus.metering : null;
          set({ meterDb: db !== null && Number.isFinite(db) ? db : null });
        },
        METERING_INTERVAL_MS
      );
      session.recording = rec as unknown as RecordingHandle;
      /**
       * A resume carries on the SAME take: the same id, the next free seq, and
       * a clock wound back to where the interrupted take stopped, so segment
       * 7's stamp is where minute 30 really was. A fresh Start gets a new take
       * and a clock at zero.
       */
      const resume = options?.resume;
      session.sessionId = resume?.sessionId ?? newLectureSessionId();
      session.openSeq = resume?.nextSeq ?? 1;
      session.openStartOffsetMs = resume?.recordedMs ?? 0;
      session.rotating = false;
      session.held.clear();
      const startedAt = Date.now() - (resume?.recordedMs ?? 0);
      clearTickTimer();
      session.tickTimer = setInterval(() => {
        set({ tick: Date.now() });
        if (get().status !== 'recording') return;
        // Stop ourselves at the cap rather than let the server refuse the
        // upload after the lecture is over. The audio is kept and named as
        // usual — this ends the recording, it does not throw it away.
        if (getSessionElapsedMs(get()) >= MAX_RECORDING_MS) {
          useToastStore
            .getState()
            .showToast('Recording reached the longest a lecture can be. Name it to transcribe.', 'info');
          void get().stopForTitle();
          return;
        }
        if (get().pausedAt) return;
        // Rotation is driven by RECORDED time, so a lecture paused for ten
        // minutes does not close a segment while nothing is being captured.
        const openMs = getSessionElapsedMs(get()) - session.openStartOffsetMs;
        if (shouldRotateLectureSegment(openMs)) void rotateSegment(set, get, noteId);
      }, 1000);
      clearAppStateSub();
      session.appStateSub = AppState.addEventListener('change', (next: AppStateStatus) => {
        if (next === 'active' && get().status === 'recording') {
          set({ tick: Date.now() });
        }
      });
      set({
        status: 'recording',
        noteId,
        noteTitle,
        startedAt,
        error: null,
        tick: startedAt,
        canRetryTranscription: false,
        pausedAt: null,
        pausedTotalMs: 0,
        sessionId: session.sessionId,
        segments: resume ? get().segments : [],
        inFlight: 0,
        ...captionFieldsForNote(get(), noteId),
      });
      // After the state is set, so the notification's text is the title the
      // banner is showing.
      applyRecordingSideEffects('recording', noteTitle);
      startCaptionStream(set, get);
    } catch {
      await resetAudioMode();
      useToastStore
        .getState()
        .showToast('Could not start recording. Check microphone permission and try again.', 'error');
      resetSession(set);
    }
  },

  discard: async () => {
    const { status } = get();
    const clearCaptions = {
      committedTranscript: '',
      interimTranscript: '',
      whisperTranscript: '',
      transcriptNoteId: null,
      sessionId: null,
      segments: [],
      inFlight: 0,
    };
    // Segments already transcribed are IN THE NOTE and were paid for. Discard
    // ends the take and drops what this phone is still holding; it does not
    // reach back into the note, which is the student's to edit.
    const dropHeld = async () => {
      for (const held of session.held.values()) await deleteRecordingFile(held.uri);
      session.held.clear();
      session.sessionId = null;
    };

    if (status === 'naming' || status === 'failed') {
      // The recorder is already down. THIS is the only path that deletes the
      // audio — a student saying "throw it away" is the one instruction that
      // may destroy a recording.
      const uri = status === 'failed' ? session.failedUri : session.pendingUri;
      await deleteRecordingFile(uri);
      await dropHeld();
      await resetAudioMode();
      resetSession(set, clearCaptions);
      return;
    }
    if (status === 'uploading' || status === 'transcribing') {
      session.abort?.abort();
      session.abort = null;
      await deleteRecordingFile(session.pendingUri ?? session.failedUri);
      await dropHeld();
      resetSession(set, clearCaptions);
      await resetAudioMode();
      return;
    }
    const rec = session.recording;
    session.recording = null;
    clearTickTimer();
    clearAppStateSub();
    applyRecordingSideEffects('idle', null);
    try {
      if (rec) await rec.stopAndUnloadAsync();
      await deleteRecordingFile(rec?.getURI() ?? null);
      await dropHeld();
    } catch {
      // ignore
    }
    await resetAudioMode();
    resetSession(set, clearCaptions);
  },

  cancelTranscription: () => {
    session.abort?.abort();
    session.abort = null;
    void resetAudioMode();
    // A cancel is not a discard: the student may still want the lecture, so
    // the file is kept and the session lands in `failed` with Retry offered.
    const uri = session.failedUri ?? session.pendingUri;
    if (uri) {
      session.failedUri = uri;
      session.pendingUri = null;
      clearTickTimer();
      clearAppStateSub();
      applyRecordingSideEffects('idle', null);
      set({
        status: 'failed',
        meterDb: null,
        pendingTitleSuggestion: null,
        canRetryTranscription: true,
        error: 'Transcription cancelled. The recording is still here.',
      });
      return;
    }
    resetSession(set);
  },

  /**
   * Half one of stopping: put the microphone down, keep the file, ask for a
   * name. Nothing is uploaded and no AI use is spent until half two, so a
   * student who stopped by mistake can still discard for free.
   */
  stopForTitle: async (options) => {
    const { status, startedAt, noteId, noteTitle } = get();
    if (status !== 'recording' || !noteId) return;
    const rec = session.recording;
    if (!rec) return;

    // Recorded time, not wall time: a lecture paused for ten minutes is not
    // ten minutes of audio and must not be priced or sized as if it were.
    const elapsed = getSessionElapsedMs(get());
    void startedAt;
    if (elapsed < MIN_LECTURE_RECORD_MS) {
      useToastStore
        .getState()
        .showToast('Keep recording for at least 2 seconds so we can capture audio.', 'info');
      return;
    }

    clearTickTimer();
    clearAppStateSub();
    persistLiveCaptions(get);
    stopCaptionStream();
    session.recording = null;
    // The microphone is going down, so the notification goes with it.
    applyRecordingSideEffects('naming', noteTitle);

    // Read the body NOW: the editor that provides it may be unmounted by the
    // time the sheet is answered.
    const fromProvider = session.currentBodyProvider?.();
    session.pendingBody =
      typeof options?.currentBody === 'string'
        ? options.currentBody
        : typeof fromProvider === 'string'
          ? fromProvider
          : undefined;

    try {
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      if (!uri) throw new Error('No recording file');
      session.pendingUri = uri;
      /**
       * The FINAL SEGMENT's length, not the take's.
       *
       * This is what the last transcription is priced on, and the take has
       * already paid for every segment before it. Sending the whole elapsed
       * time here would re-buy the entire lecture at the end of it.
       */
      session.pendingElapsedMs = Math.max(0, elapsed - session.openStartOffsetMs);
      // The store's copy of the title is refreshed from the notes store here:
      // it was captured at start, and the editor adopts it when the upload
      // begins, so a stale copy would undo a rename made mid-lecture.
      const liveTitle = currentTitleForNote(noteId, noteTitle);
      set({
        status: 'naming',
        error: null,
        meterDb: null,
        noteTitle: liveTitle || noteTitle,
        pendingTitleSuggestion: suggestedLectureTitle(liveTitle),
        canRetryTranscription: false,
      });
    } catch {
      await resetAudioMode();
      useToastStore.getState().showToast('Could not save that recording.', 'error');
      resetSession(set);
    }
  },

  /** Half two: name the note, then upload and transcribe. */
  confirmTitleAndTranscribe: async (typedTitle) => {
    const { status, noteId, noteTitle } = get();
    if (status !== 'naming' || !noteId) return;
    const uri = session.pendingUri;
    if (!uri) {
      resetSession(set);
      return;
    }
    session.pendingUri = null;
    // Held from here on: if the upload fails, this is what `Retry` uses.
    session.failedUri = uri;

    const plan = planTitleAtStop({
      currentTitle: currentTitleForNote(noteId, noteTitle),
      typedTitle,
    });
    if (plan.shouldRename) {
      try {
        await useNotesStore.getState().saveNote(noteId, { title: plan.nextTitle });
        set({ noteTitle: plan.nextTitle });
      } catch {
        // A title that would not save must not cost the student the recording.
      }
    }

    await runTranscription(set, get);
  },

  /**
   * Pause, rather than stop.
   *
   * `expo-av` resumes into the same file, so a lecture interrupted by a phone
   * call or a walk to the next room stays ONE recording — the alternative is
   * two half-lectures and two charges. The notification and the wake lock stay
   * up: the session still owns the microphone.
   */
  pauseRecording: async () => {
    const { status, pausedAt } = get();
    if (status !== 'recording' || pausedAt) return;
    const rec = session.recording;
    if (!rec?.pauseAsync) return;
    try {
      await rec.pauseAsync();
      persistLiveCaptions(get);
      stopCaptionStream();
      set({ pausedAt: Date.now(), meterDb: null, tick: Date.now(), interimTranscript: '' });
    } catch {
      useToastStore.getState().showToast('Could not pause. Still recording.', 'info');
    }
  },

  /** Carry on into the same file. The paused stretch is never billed. */
  resumeRecording: async () => {
    const { status, pausedAt, pausedTotalMs } = get();
    if (status !== 'recording' || !pausedAt) return;
    const rec = session.recording;
    if (!rec?.startAsync) return;
    try {
      await rec.startAsync();
      set({
        pausedAt: null,
        pausedTotalMs: pausedTotalAfterResume(pausedTotalMs, pausedAt),
        tick: Date.now(),
      });
      startCaptionStream(set, get);
    } catch {
      // The recorder would not restart. Say so plainly and leave the session
      // paused with its audio intact rather than pretending it resumed.
      useToastStore
        .getState()
        .showToast('Could not resume. Stop to keep what you have already recorded.', 'error');
    }
  },

  /**
   * The offer a failure leaves behind.
   *
   * It spends nothing until the upload succeeds — the server charges on the
   * transcription route, and a retry that never reaches it costs the same as
   * the attempt that failed: nothing.
   */
  retryTranscription: async () => {
    const { status } = get();
    if (status !== 'failed') return;
    if (session.failedUri) {
      await runTranscription(set, get);
      return;
    }
    // No final segment outstanding: only earlier ones failed.
    for (const row of get().segments.filter((item) => item.status !== 'done')) {
      await get().retrySegment(row.seq);
    }
  },

  /**
   * Transcribe one segment again.
   *
   * Two doors, because the audio can be in either place. This phone may still
   * hold the cache file (a transcription that failed while the lecture ran), in
   * which case the whole prepare/upload/transcribe run happens again and the
   * server recognises the segment and charges nothing extra. Or the file is
   * gone and the row is all there is — then the audio is already in storage and
   * only the words are missing, which is what a reload's Retry acts on.
   */
  retrySegment: async (seq) => {
    const state = get();
    const noteId = state.noteId ?? state.transcriptNoteId;
    const sessionId = state.sessionId;
    if (!noteId || !sessionId) return;
    const row = state.segments.find((item) => item.seq === seq);
    if (!row || row.status === 'done') return;

    const setFn = (fn: (s: LectureRecordingState) => Partial<LectureRecordingState>) => {
      useLectureRecordingStore.setState(fn as never);
    };
    const held = session.held.get(seq);
    if (held) {
      await runSegmentUpload(setFn, set, get, noteId, sessionId, held);
      return;
    }

    set({ inFlight: get().inFlight + 1 });
    patchSegment(setFn, seq, { status: 'transcribing', error: undefined });
    try {
      const ticket = await prepareLectureSegmentUpload({
        noteId,
        sessionId,
        seq,
        startOffsetMs: row.startOffsetMs,
        durationMs: row.durationMs,
        mimeType: 'audio/mp4',
        byteLength: 0,
      });
      const result = await transcribeLectureSegment({
        noteId,
        sessionId,
        seq,
        startOffsetMs: row.startOffsetMs,
        durationMs: row.durationMs,
        storagePath: ticket.storagePath,
        mimeType: ticket.mimeType,
        fileName: ticket.fileName,
        byteLength: 0,
        ...lectureTranscribeLanguages(),
      });
      patchSegment(setFn, seq, {
        status: 'done',
        transcript: (result.transcript ?? '').trim(),
        error: undefined,
      });
      if (typeof result.transcriptText === 'string') {
        set({ whisperTranscript: result.transcriptText });
      }
      void fetchAIUsage();
    } catch (error: unknown) {
      patchSegment(setFn, seq, {
        status: 'failed',
        error:
          error instanceof Error ? error.message : 'Could not transcribe this part of the lecture.',
      });
    } finally {
      set({ inFlight: Math.max(0, get().inFlight - 1) });
    }
  },

  /**
   * Read the note's own segment rows.
   *
   * This is what makes a killed app recoverable: the rows were written before
   * the audio was transcribed, so an app Android reaped mid-lecture left a
   * trail on the server that the cache file could never have left. Never called
   * while a take is running — the live list is the truth then.
   */
  hydrateFromNote: (noteId, attachments) => {
    if (get().status !== 'idle') return;
    const rows: LectureSegmentRow[] = lectureSegmentRows(attachments ?? []);
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
        status: row.status === 'done' && row.transcript ? ('done' as const) : ('failed' as const),
        transcript: row.transcript,
        error:
          row.status === 'done' && row.transcript
            ? undefined
            : 'This part was recorded but never transcribed.',
        attachmentId: row.attachmentId,
        fileName: row.fileName,
        fileUrl: row.fileUrl,
        createdAt: row.createdAt,
      })),
    });
  },
}));

/**
 * Upload and transcribe whatever `session.failedUri` is holding.
 *
 * Shared by the first attempt and every retry, so the two cannot drift. The
 * one rule it exists to keep: a failure LEAVES THE FILE ALONE. The old
 * `finally { resetSession() }` was what turned a dropped Wi-Fi connection into
 * a lost lecture — the store went back to idle and the audio stayed in the
 * cache with nothing pointing at it.
 */
async function runTranscription(
  set: (partial: Partial<LectureRecordingState>) => void,
  get: () => LectureRecordingState
): Promise<void> {
  const uri = session.failedUri;
  const noteId = get().noteId;
  const sessionId = session.sessionId;
  if (!uri || !noteId || !sessionId) {
    resetSession(set);
    return;
  }
  const seq = session.openSeq;
  const startOffsetMs = session.openStartOffsetMs;
  const durationMs = session.pendingElapsedMs;

  set({
    status: 'uploading',
    error: null,
    pendingTitleSuggestion: null,
    canRetryTranscription: false,
  });

  const held: HeldSegment = { uri, seq, startOffsetMs, durationMs };
  session.held.set(seq, held);
  const setFn = (fn: (state: LectureRecordingState) => Partial<LectureRecordingState>) => {
    useLectureRecordingStore.setState(fn as never);
  };
  setFn((state) => ({
    segments: [
      ...state.segments.filter((row) => row.seq !== seq),
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

  set({ status: 'transcribing' });
  await runSegmentUpload(setFn, set, get, noteId, sessionId, held);

  // Everything outstanding, not only the piece just closed: a segment that
  // failed mid-lecture is still holding its audio, and this is the moment the
  // student is watching a spinner anyway.
  const outstanding = get().segments.filter((row) => row.status === 'failed');
  for (const row of outstanding) {
    const heldRow = session.held.get(row.seq);
    if (heldRow) await runSegmentUpload(setFn, set, get, noteId, sessionId, heldRow);
  }

  await useNotesStore.getState().loadNote(noteId).catch(() => undefined);
  await resetAudioMode();
  session.abort = null;

  const failed = get().segments.filter((row) => row.status !== 'done');
  if (failed.length > 0) {
    // The failure path: keep the files, keep the note, offer Retry. Nothing
    // here signs the student out or clears the session — a dropped connection
    // is a transient failure, not a reason to lose an hour of lecture.
    const message = `${failed.length} part${failed.length === 1 ? '' : 's'} of this lecture did not transcribe. The audio is saved — tap Retry.`;
    useToastStore.getState().showToast(message, 'error');
    set({
      status: 'failed',
      error: message,
      canRetryTranscription: true,
      meterDb: null,
    });
    return;
  }

  useToastStore.getState().showToast('Transcript ready', 'success');
  session.failedUri = null;
  const current = get();
  resetSession(set, {
    whisperTranscript: current.whisperTranscript,
    transcriptNoteId: noteId,
    committedTranscript: '',
    interimTranscript: '',
    sessionId: current.sessionId,
    segments: current.segments,
    inFlight: 0,
  });
}

export const MIN_MOBILE_LECTURE_RECORD_MS = MIN_LECTURE_RECORD_MS;
export const MAX_MOBILE_LECTURE_RECORD_MS = MAX_RECORDING_MS;
export const LECTURE_SCREEN_OFF_SURVIVES = hasLectureForegroundService;
