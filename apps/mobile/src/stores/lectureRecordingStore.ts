import { create } from 'zustand';
import { AppState, type AppStateStatus } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { maxLectureRecordingMs } from '@lantern/shared/utils/lectureAudio';
import { fetchAIUsage } from '../services/ai';
import { transcribeAudioForNote } from '../services/notes';
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

  start: (noteId: string, noteTitle: string, options?: { currentBody?: string }) => Promise<void>;
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
  setCurrentBodyProvider: (provider: (() => string) | null) => void;
  isActiveForNote: (noteId: string) => boolean;
}

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

  start: async (noteId, noteTitle) => {
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
      const startedAt = Date.now();
      clearTickTimer();
      session.tickTimer = setInterval(() => {
        set({ tick: Date.now() });
        // Stop ourselves at the cap rather than let the server refuse the
        // upload after the lecture is over. The audio is kept and named as
        // usual — this ends the recording, it does not throw it away.
        if (get().status === 'recording' && getSessionElapsedMs(get()) >= MAX_RECORDING_MS) {
          useToastStore
            .getState()
            .showToast('Recording reached the longest a lecture can be. Name it to transcribe.', 'info');
          void get().stopForTitle();
        }
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
        ...captionFieldsForNote(get(), noteId),
      });
      // After the state is set, so the notification's text is the title the
      // banner is showing.
      applyRecordingSideEffects('recording', noteTitle);
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
    };
    if (status === 'naming' || status === 'failed') {
      // The recorder is already down. THIS is the only path that deletes the
      // audio — a student saying "throw it away" is the one instruction that
      // may destroy a recording.
      const uri = status === 'failed' ? session.failedUri : session.pendingUri;
      await deleteRecordingFile(uri);
      await resetAudioMode();
      resetSession(set, clearCaptions);
      return;
    }
    if (status === 'uploading' || status === 'transcribing') {
      session.abort?.abort();
      session.abort = null;
      await deleteRecordingFile(session.pendingUri ?? session.failedUri);
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
      session.pendingElapsedMs = elapsed;
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
      set({ pausedAt: Date.now(), meterDb: null, tick: Date.now() });
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
    if (status !== 'failed' || !session.failedUri) return;
    await runTranscription(set, get);
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
  if (!uri || !noteId) {
    resetSession(set);
    return;
  }
  const elapsed = session.pendingElapsedMs;
  set({
    status: 'uploading',
    error: null,
    pendingTitleSuggestion: null,
    canRetryTranscription: false,
  });

  const abortController = new AbortController();
  session.abort = abortController;

  try {
    const info = await FileSystem.getInfoAsync(uri);
    const byteLength = info.exists && 'size' in info ? Number(info.size) || 0 : 0;
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType?.Base64 ?? 'base64',
    });
    if (!base64 || base64.length < 64 || (byteLength > 0 && byteLength < 256)) {
      throw new Error(
        `Recording was empty. Hold a bit longer, then stop again. (${Math.round(elapsed / 1000)}s, ${byteLength || base64.length}B)`
      );
    }

    const lowerUri = uri.toLowerCase();
    const mimeType = lowerUri.endsWith('.webm')
      ? 'audio/webm'
      : lowerUri.endsWith('.wav')
        ? 'audio/wav'
        : lowerUri.endsWith('.ogg')
          ? 'audio/ogg'
          : 'audio/mp4';
    const ext = lowerUri.endsWith('.webm')
      ? 'webm'
      : lowerUri.endsWith('.wav')
        ? 'wav'
        : lowerUri.endsWith('.ogg')
          ? 'ogg'
          : 'm4a';

    const notesState = useNotesStore.getState();
    const currentBody =
      typeof session.pendingBody === 'string'
        ? session.pendingBody
        : notesState.selectedNote?.id === noteId
          ? notesState.selectedNote.body
          : notesState.notes.find((n) => n.id === noteId)?.body;

    set({ status: 'transcribing' });
    const result = await transcribeAudioForNote(base64, {
      mimeType,
      noteId,
      fileName: `lecture-${Date.now()}.${ext}`,
      signal: abortController.signal,
      currentBody: typeof currentBody === 'string' ? currentBody : undefined,
      durationMs: elapsed,
      clientByteLength: byteLength || undefined,
      localFileUri: uri,
      useStoragePath: true,
    });

    await useNotesStore.getState().loadNote(noteId);

    if (result.persistWarning) {
      useToastStore.getState().showToast(result.persistWarning, 'info');
    } else if (result.transcript) {
      useToastStore.getState().showToast('Transcript ready', 'success');
    }
    void fetchAIUsage();
    // The transcript is in the note and the audio is in storage; the cache
    // copy has no reader left.
    session.abort = null;
    await deleteRecordingFile(uri);
    await resetAudioMode();
    const incoming = result.transcript?.trim() ?? '';
    const current = get();
    const previous =
      current.transcriptNoteId === noteId ? current.whisperTranscript.trim() : '';
    resetSession(set, {
      whisperTranscript: previous && incoming && previous !== incoming
        ? `${previous}\n\n${incoming}`
        : incoming || previous,
      transcriptNoteId: noteId,
      committedTranscript: current.committedTranscript,
      interimTranscript: '',
    });
  } catch (e: unknown) {
    // Only this attempt's controller may be cleared: a Discard followed by a
    // fresh recording can have installed a new one before this rejection lands.
    if (session.abort === abortController) session.abort = null;
    if (abortController.signal.aborted || (e instanceof Error && e.name === 'AbortError')) {
      // `cancelTranscription` or `discard` has already decided what state to
      // be in. Checking the signal, not just the error's name, means a network
      // error surfacing after the abort cannot drag a reset session back into
      // `failed` with no file behind it.
      return;
    }
    const message = e instanceof Error ? e.message : 'Could not transcribe audio';
    useToastStore.getState().showToast(message, 'error');
    await resetAudioMode();
    // The failure path: keep the file, keep the note, offer Retry. Nothing
    // here signs the student out or clears the session — a dropped connection
    // is a transient failure, not a reason to lose an hour of lecture.
    set({
      status: 'failed',
      error: message,
      canRetryTranscription: true,
      meterDb: null,
    });
  }
}

export const MIN_MOBILE_LECTURE_RECORD_MS = MIN_LECTURE_RECORD_MS;
export const MAX_MOBILE_LECTURE_RECORD_MS = MAX_RECORDING_MS;
export const LECTURE_SCREEN_OFF_SURVIVES = hasLectureForegroundService;
