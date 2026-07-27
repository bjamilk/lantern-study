import { create } from 'zustand';
import { AppState, type AppStateStatus } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { fetchAIUsage } from '../services/ai';
import { transcribeAudioForNote } from '../services/notes';
import { useNotesStore } from './notesStore';
import { useToastStore } from './toastStore';

export type LectureRecordingStatus = 'idle' | 'recording' | 'uploading' | 'transcribing';

const MIN_LECTURE_RECORD_MS = 2000;

type RecordingHandle = {
  stopAndUnloadAsync: () => Promise<void>;
  getURI: () => string | null;
};

type ExpoAudioModule = typeof import('expo-av').Audio;

interface LectureRecordingState {
  status: LectureRecordingStatus;
  noteId: string | null;
  noteTitle: string | null;
  startedAt: number | null;
  error: string | null;
  tick: number;

  start: (noteId: string, noteTitle: string, options?: { currentBody?: string }) => Promise<void>;
  stopAndTranscribe: (options?: { currentBody?: string }) => Promise<void>;
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
};

const session: SessionRefs = {
  recording: null,
  abort: null,
  currentBodyProvider: null,
  tickTimer: null,
  appStateSub: null,
  AudioMod: null,
};

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

function resetSession(
  set: (partial: Partial<LectureRecordingState>) => void,
  extras?: Partial<LectureRecordingState>
) {
  clearTickTimer();
  clearAppStateSub();
  session.recording = null;
  session.abort = null;
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

export function getElapsedRecordingSeconds(startedAt: number | null): number {
  if (!startedAt) return 0;
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
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

  setCurrentBodyProvider: (provider) => {
    session.currentBodyProvider = provider;
  },

  isActiveForNote: (noteId) => {
    const { noteId: activeId, status } = get();
    return Boolean(activeId === noteId && status !== 'idle');
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
    if (current.status === 'uploading' || current.status === 'transcribing') {
      useToastStore.getState().showToast('Wait for transcription to finish.', 'info');
      return;
    }

    try {
      const { Audio: AudioMod } = await import('expo-av');
      session.AudioMod = AudioMod;
      const permission = await AudioMod.requestPermissionsAsync();
      if (!permission.granted) {
        useToastStore
          .getState()
          .showToast('Microphone access is required to record lectures.', 'error');
        return;
      }
      await AudioMod.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        playThroughEarpieceAndroid: false,
      });
      const { recording: rec } = await AudioMod.Recording.createAsync(
        AudioMod.RecordingOptionsPresets.HIGH_QUALITY
      );
      session.recording = rec as unknown as RecordingHandle;
      const startedAt = Date.now();
      clearTickTimer();
      session.tickTimer = setInterval(() => {
        set({ tick: Date.now() });
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
      });
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
    if (status === 'uploading' || status === 'transcribing') {
      session.abort?.abort();
      session.abort = null;
      resetSession(set);
      await resetAudioMode();
      return;
    }
    const rec = session.recording;
    session.recording = null;
    clearTickTimer();
    clearAppStateSub();
    try {
      if (rec) await rec.stopAndUnloadAsync();
    } catch {
      // ignore
    }
    await resetAudioMode();
    resetSession(set);
  },

  cancelTranscription: () => {
    session.abort?.abort();
    session.abort = null;
    void resetAudioMode();
    resetSession(set);
  },

  stopAndTranscribe: async (options) => {
    const { status, startedAt, noteId } = get();
    if (status !== 'recording' || !noteId) return;
    const rec = session.recording;
    if (!rec) return;

    const elapsed = Date.now() - (startedAt ?? 0);
    if (elapsed < MIN_LECTURE_RECORD_MS) {
      useToastStore
        .getState()
        .showToast('Keep recording for at least 2 seconds so we can capture audio.', 'info');
      return;
    }

    clearTickTimer();
    clearAppStateSub();
    session.recording = null;
    set({ status: 'uploading', error: null });

    const abortController = new AbortController();
    session.abort = abortController;

    try {
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      if (!uri) throw new Error('No recording file');

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

      const fromProvider = session.currentBodyProvider?.();
      const notesState = useNotesStore.getState();
      const currentBody =
        typeof options?.currentBody === 'string'
          ? options.currentBody
          : typeof fromProvider === 'string'
            ? fromProvider
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
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return;
      const message = e instanceof Error ? e.message : 'Could not transcribe audio';
      useToastStore.getState().showToast(message, 'error');
      set({ error: message });
    } finally {
      session.abort = null;
      await resetAudioMode();
      resetSession(set);
    }
  },
}));

export const MIN_MOBILE_LECTURE_RECORD_MS = MIN_LECTURE_RECORD_MS;
