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
import { create } from 'zustand';
import * as notesApi from '../services/notes';
import {
  MIN_LECTURE_RECORD_MS,
  blobToBase64,
  encodeBlobAsWav,
  formatTranscribeDiag,
  waitForRecorderChunks,
} from '../services/lectureRecording';
import { fetchAIUsage } from '../services/ai';
import { useNotesStore } from './notesStore';
import { useToastStore } from './toastStore';

export type LectureRecordingStatus = 'idle' | 'recording' | 'uploading' | 'transcribing';

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
  /** Final browser-caption chunks for this note. */
  committedTranscript: string;
  /** In-progress caption, replaced as the speech engine revises it. */
  interimTranscript: string;
  /** Last Whisper transcript persisted onto the note. */
  whisperTranscript: string;
  /** Note the caption/whisper fields belong to, kept after idle. */
  transcriptNoteId: string | null;

  start: (noteId: string, noteTitle: string, options?: { currentBody?: string }) => Promise<void>;
  stopAndTranscribe: (options?: { currentBody?: string }) => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
  discard: () => void;
  cancelTranscription: () => void;
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
  recordedMs: number;
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
  recordedMs: 0,
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
    // Captions are best-effort. The MediaRecorder take is the source of truth.
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
  session.recordedMs = 0;
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

async function runTranscription(
  set: (partial: Partial<LectureRecordingState>) => void,
  get: () => LectureRecordingState,
  blob: Blob,
  recordingMime: string,
  durationMs: number,
  noteId: string
) {
  const abortController = new AbortController();
  session.abort = abortController;
  set({ status: 'uploading', error: null });

  const notesState = useNotesStore.getState();
  const fromProvider = session.currentBodyProvider?.();
  const currentBody =
    typeof fromProvider === 'string'
      ? fromProvider
      : notesState.selectedNote?.id === noteId
        ? notesState.selectedNote.body
        : notesState.notes.find((n) => n.id === noteId)?.body;

  try {
    const runTranscribe = async (audioBlob: Blob, mime: string, fileExt: string) => {
      const base64 = await blobToBase64(audioBlob);
      if (!base64 || base64.length < 64) {
        throw new Error(
          `Recording was empty or too short. Hold for at least 2 seconds, then stop.${formatTranscribeDiag({
            blobSize: audioBlob.size,
            mimeType: mime,
            durationMs,
          })}`
        );
      }
      return notesApi.transcribeAudioForNote(base64, {
        mimeType: mime,
        noteId,
        fileName: `lecture-${Date.now()}.${fileExt}`,
        signal: abortController.signal,
        currentBody: typeof currentBody === 'string' ? currentBody : undefined,
        durationMs,
        clientByteLength: audioBlob.size,
        audioBlob,
        useStoragePath: true,
        onProgress: (progress) => {
          if (get().noteId !== noteId) return;
          if (progress.stage === 'uploading') set({ status: 'uploading' });
          if (progress.stage === 'processing') set({ status: 'transcribing' });
        },
      });
    };

    let mimeType = recordingMime.split(';')[0] || 'audio/webm';
    let ext = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
    let workingBlob = blob;
    let result: Awaited<ReturnType<typeof notesApi.transcribeAudioForNote>>;
    try {
      result = await runTranscribe(workingBlob, mimeType, ext);
    } catch (firstErr: unknown) {
      const firstMessage = firstErr instanceof Error ? firstErr.message : '';
      const shouldRetryAsWav =
        /could not read that recording|unsupported|invalid.*media/i.test(firstMessage) &&
        !mimeType.includes('wav');
      if (!shouldRetryAsWav) throw firstErr;
      workingBlob = await encodeBlobAsWav(workingBlob);
      mimeType = 'audio/wav';
      ext = 'wav';
      result = await runTranscribe(workingBlob, mimeType, ext);
    }

    if (result.note) {
      const notesState = useNotesStore.getState();
      const merged = result.note as typeof notesState.selectedNote;
      notesState.setNotes(
        notesState.notes.map((n) => (n.id === noteId ? { ...n, ...result.note! } : n))
      );
      if (notesState.selectedNote?.id === noteId && merged) {
        notesState.setSelectedNote({
          ...notesState.selectedNote,
          ...merged,
          attachments: merged.attachments ?? notesState.selectedNote.attachments,
        });
      }
    } else {
      await useNotesStore.getState().loadNote(noteId);
    }

    if (result.transcript) {
      const incoming = result.transcript.trim();
      const current = get();
      const sameNote = current.transcriptNoteId === noteId;
      const previous = sameNote ? current.whisperTranscript.trim() : '';
      set({
        whisperTranscript: previous && incoming && previous !== incoming
          ? `${previous}\n\n${incoming}`
          : incoming || previous,
        transcriptNoteId: noteId,
        interimTranscript: '',
      });
      useToastStore.getState().showToast('Transcript ready', 'success');
    }
    if (result.persistWarning) {
      useToastStore.getState().showToast(result.persistWarning, 'info');
    }
    void fetchAIUsage();
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    const message = err instanceof Error ? err.message : 'Transcription failed';
    const diag = formatTranscribeDiag({
      blobSize: blob.size,
      mimeType: recordingMime,
      durationMs,
    });
    useToastStore
      .getState()
      .showToast(message.includes('(') ? message : `${message}${diag}`, 'error');
    set({ error: message });
  } finally {
    session.abort = null;
    if (get().noteId === noteId || get().status !== 'idle') {
      resetSessionState(set);
    }
  }
}

export const useLectureRecordingStore = create<LectureRecordingState>((set, get) => ({
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

  setCurrentBodyProvider: (provider) => {
    session.currentBodyProvider = provider;
  },

  isActiveForNote: (noteId) => {
    const { noteId: activeId, status } = get();
    return Boolean(activeId === noteId && status !== 'idle');
  },

  isBusy: () => get().status !== 'idle',

  start: async (noteId, noteTitle, options) => {
    const current = get();
    if (current.status === 'recording') {
      if (current.noteId === noteId) return;
      useToastStore
        .getState()
        .showToast('A lecture is already recording. Stop or discard it first.', 'info');
      return;
    }
    if (current.status === 'uploading' || current.status === 'transcribing') {
      useToastStore.getState().showToast('Wait for transcription to finish.', 'info');
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
      const stream = await getUserMediaWithTimeout({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: LECTURE_AUDIO_CHANNELS,
          // A hint, not a guarantee — browsers are free to ignore it. The
          // bitrate above is what actually bounds the file size.
          sampleRate: LECTURE_AUDIO_SAMPLE_RATE_HZ,
        },
      });
      session.mediaStream = stream;
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
      // Speech, not music. The browser's default Opus bitrate is roughly
      // four times what a transcript needs, and the server refuses anything
      // over 25 MB — a long lecture was recorded in full and then rejected at
      // the upload. Both platforms now record at the same rate, so a lecture
      // that fits on the phone fits here. See @lantern/shared/utils/lectureAudio.
      const recorderOptions: MediaRecorderOptions = {
        audioBitsPerSecond: LECTURE_AUDIO_BITS_PER_SECOND,
      };
      const recorder = supportedMime
        ? new MediaRecorder(stream, { ...recorderOptions, mimeType: supportedMime })
        : new MediaRecorder(stream, recorderOptions);
      const recordingMime = recorder.mimeType || supportedMime || 'audio/webm';
      session.recordingMime = recordingMime;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) session.chunks.push(e.data);
      };
      recorder.onerror = () => {
        useToastStore.getState().showToast('Recording failed. Please try again.', 'error');
        stopMediaStream();
        resetSessionState(set);
      };
      recorder.onstop = async () => {
        const activeNoteId = get().noteId;
        const startedAt = get().startedAt ?? Date.now();
        if (session.discard) {
          session.discard = false;
          session.chunks = [];
          stopMediaStream();
          resetSessionState(set, {
            committedTranscript: '',
            interimTranscript: '',
            whisperTranscript: '',
            transcriptNoteId: null,
          });
          return;
        }

        await waitForRecorderChunks(() => session.chunks);
        const durationMs =
          session.recordedMs > 0 ? session.recordedMs : Date.now() - startedAt;
        const blob = new Blob(session.chunks, { type: recordingMime });
        session.chunks = [];
        stopMediaStream();
        session.mediaRecorder = null;

        if (!activeNoteId) {
          resetSessionState(set);
          return;
        }

        if (blob.size < 512) {
          useToastStore.getState().showToast(
            `Recording was empty or too short. Hold for at least 2 seconds, then stop.${formatTranscribeDiag({
              blobSize: blob.size,
              mimeType: recordingMime,
              durationMs,
            })}`,
            'error'
          );
          resetSessionState(set);
          return;
        }

        await runTranscription(set, get, blob, recordingMime, durationMs, activeNoteId);
      };

      session.mediaRecorder = recorder;
      recorder.start(250);
      const startedAt = Date.now();
      const sameNote = get().transcriptNoteId === noteId;
      clearTickTimer();
      session.tickTimer = setInterval(() => {
        set({ tick: Date.now() });
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
        committedTranscript: sameNote ? get().committedTranscript : '',
        interimTranscript: '',
        whisperTranscript: sameNote ? get().whisperTranscript : '',
        transcriptNoteId: noteId,
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
      resetSessionState(set, { error: message });
    }
  },

  stopAndTranscribe: () => {
    const current = get();
    if (current.status !== 'recording') return;
    const recorder = session.mediaRecorder;
    if (!recorder) return;
    const elapsed = getSessionElapsedMs(current);
    if (elapsed < MIN_LECTURE_RECORD_MS) {
      useToastStore
        .getState()
        .showToast('Keep recording for at least 2 seconds so we can capture audio.', 'info');
      return;
    }
    session.discard = false;
    session.recordedMs = elapsed;
    stopCaptionStream();
    clearTickTimer();
    try {
      if (recorder.state === 'recording' || recorder.state === 'paused') {
        recorder.stop();
      }
    } catch {
      // ignore
    }
    // Status moves to uploading inside onstop → runTranscription
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

  discard: () => {
    const { status } = get();
    const clearCaptions = {
      committedTranscript: '',
      interimTranscript: '',
      whisperTranscript: '',
      transcriptNoteId: null,
    };
    if (status === 'uploading' || status === 'transcribing') {
      session.abort?.abort();
      session.abort = null;
      resetSessionState(set, clearCaptions);
      return;
    }
    if (status !== 'recording') {
      resetSessionState(set, clearCaptions);
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
        resetSessionState(set, clearCaptions);
      }
    } catch {
      stopMediaStream();
      resetSessionState(set, clearCaptions);
    }
  },

  cancelTranscription: () => {
    session.abort?.abort();
    session.abort = null;
    resetSessionState(set);
  },
}));

export function isLectureRecordingActive(): boolean {
  return useLectureRecordingStore.getState().status !== 'idle';
}
