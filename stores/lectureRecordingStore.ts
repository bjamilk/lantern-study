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

  start: (noteId: string, noteTitle: string, options?: { currentBody?: string }) => Promise<void>;
  stopAndTranscribe: (options?: { currentBody?: string }) => void;
  discard: () => void;
  cancelTranscription: () => void;
  /** Provide latest editor body for the active note (optional). */
  setCurrentBodyProvider: (provider: (() => string) | null) => void;
  isActiveForNote: (noteId: string) => boolean;
  isBusy: () => boolean;
}

type SessionRefs = {
  mediaRecorder: MediaRecorder | null;
  mediaStream: MediaStream | null;
  chunks: Blob[];
  discard: boolean;
  abort: AbortController | null;
  recordingMime: string;
  currentBodyProvider: (() => string) | null;
  tickTimer: ReturnType<typeof setInterval> | null;
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

function resetSessionState(
  set: (partial: Partial<LectureRecordingState>) => void,
  extras?: Partial<LectureRecordingState>
) {
  clearTickTimer();
  session.mediaRecorder = null;
  session.chunks = [];
  session.discard = false;
  session.recordingMime = 'audio/webm';
  set({
    status: 'idle',
    noteId: null,
    noteTitle: null,
    startedAt: null,
    error: null,
    tick: 0,
    ...extras,
  });
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
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
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
      const recorder = supportedMime
        ? new MediaRecorder(stream, { mimeType: supportedMime })
        : new MediaRecorder(stream);
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
          resetSessionState(set);
          return;
        }

        await waitForRecorderChunks(() => session.chunks);
        const durationMs = Date.now() - startedAt;
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
      });
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
            : 'Microphone access is required to record lectures.';
      useToastStore.getState().showToast(message, 'error');
      resetSessionState(set, { error: message });
    }
  },

  stopAndTranscribe: () => {
    const { status, startedAt } = get();
    if (status !== 'recording') return;
    const recorder = session.mediaRecorder;
    if (!recorder) return;
    const elapsed = Date.now() - (startedAt ?? 0);
    if (elapsed < MIN_LECTURE_RECORD_MS) {
      useToastStore
        .getState()
        .showToast('Keep recording for at least 2 seconds so we can capture audio.', 'info');
      return;
    }
    session.discard = false;
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

  discard: () => {
    const { status } = get();
    if (status === 'uploading' || status === 'transcribing') {
      session.abort?.abort();
      session.abort = null;
      resetSessionState(set);
      return;
    }
    if (status !== 'recording') {
      resetSessionState(set);
      return;
    }
    session.discard = true;
    const recorder = session.mediaRecorder;
    session.mediaRecorder = null;
    session.chunks = [];
    clearTickTimer();
    try {
      if (recorder && (recorder.state === 'recording' || recorder.state === 'paused')) {
        recorder.stop();
      } else {
        stopMediaStream();
        resetSessionState(set);
      }
    } catch {
      stopMediaStream();
      resetSessionState(set);
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
