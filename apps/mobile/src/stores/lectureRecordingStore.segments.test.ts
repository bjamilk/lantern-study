/**
 * The phone's segmented recorder, driven without a microphone.
 *
 * On Android the app being killed mid-lecture is routine, not exceptional, so
 * what is asserted here is the difference between losing five minutes and
 * losing an hour:
 *
 *  - the recorder ROTATES on recorded time, closing a segment and opening a new
 *    `Audio.Recording` without ending the lecture;
 *  - each closed segment is uploaded and transcribed while the lecture runs,
 *    and its cache file is deleted only once the server has the words;
 *  - a pause neither rotates nor advances the clock;
 *  - the FINAL segment is priced on its own length, not on the whole take —
 *    sending the elapsed time there would re-buy the entire lecture at the end;
 *  - a reload finds the take on the SERVER and can carry on into the same
 *    sequence.
 */
const prepareLectureSegmentUpload = jest.fn();
const uploadLectureSegment = jest.fn();
const transcribeLectureSegment = jest.fn();
const deletedFiles: string[] = [];

jest.mock('../services/notes', () => ({
  prepareLectureSegmentUpload: (...args: unknown[]) => prepareLectureSegmentUpload(...args),
  uploadLectureSegment: (...args: unknown[]) => uploadLectureSegment(...args),
  transcribeLectureSegment: (...args: unknown[]) => transcribeLectureSegment(...args),
}));

jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn(async () => ({ exists: true, size: 512_000 })),
  deleteAsync: jest.fn(async (uri: string) => {
    deletedFiles.push(uri);
  }),
  readAsStringAsync: jest.fn(async () => 'AAAA'),
  EncodingType: { Base64: 'base64' },
}));

let nextRecordingUri = 1;
const createAsync = jest.fn(async () => ({
  recording: {
    stopAndUnloadAsync: jest.fn(async () => {}),
    getURI: () => `file:///cache/lecture-${nextRecordingUri}.m4a`,
    pauseAsync: jest.fn(async () => {}),
    startAsync: jest.fn(async () => {}),
  },
}));

jest.mock('expo-av', () => ({
  Audio: {
    requestPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
    getPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
    setAudioModeAsync: jest.fn(async () => {}),
    Recording: {
      createAsync: (...args: unknown[]) => createAsync(...(args as [])),
    },
    RecordingOptionsPresets: { HIGH_QUALITY: {} },
  },
}));

jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn(async () => {}),
  deactivateKeepAwake: jest.fn(),
}));
jest.mock('../../modules/lecture-recording-service', () => ({
  hasLectureForegroundService: false,
  startLectureForegroundService: jest.fn(() => false),
  stopLectureForegroundService: jest.fn(),
}));
jest.mock('../services/liveSpeech', () => ({ startLiveCaptionStream: jest.fn(async () => null) }));
jest.mock('../services/ai', () => ({ fetchAIUsage: jest.fn() }));
jest.mock('./notesStore', () => ({
  useNotesStore: {
    getState: () => ({
      notes: [],
      selectedNote: null,
      saveNote: jest.fn(async () => {}),
      loadNote: jest.fn(async () => {}),
    }),
  },
}));
jest.mock('./settingsStore', () => ({
  useSettingsStore: { getState: () => ({ settings: { lecture: {} } }) },
}));
const toasts: Array<{ message: string; kind: string }> = [];
jest.mock('./toastStore', () => ({
  useToastStore: {
    getState: () => ({
      showToast: (message: string, kind: string) => toasts.push({ message, kind }),
    }),
  },
}));
jest.mock('react-native', () => ({
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));

import { useLectureRecordingStore, getSessionElapsedMs } from './lectureRecordingStore';
import { LECTURE_SEGMENT_MS } from '@lantern/shared/utils/lectureSegments';

const MIN = 60_000;
const state = () => useLectureRecordingStore.getState();

/** Let the store's un-awaited segment work settle. */
async function flush(times = 10) {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(0);
  }
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-18T09:00:00.000Z'));
  toasts.length = 0;
  deletedFiles.length = 0;
  nextRecordingUri = 1;
  createAsync.mockClear();
  prepareLectureSegmentUpload.mockReset().mockImplementation(async (input: any) => ({
    storagePath: `u1/lecture-${input.noteId}-${input.seq}.m4a`,
    signedUrl: 'https://upload.example/x',
    token: 'tok',
    bucket: 'note-files',
    mimeType: 'audio/mp4',
    fileName: `lecture-${input.noteId}-${input.seq}.m4a`,
    attachmentId: `att-${input.seq}`,
    alreadyTranscribed: false,
  }));
  uploadLectureSegment.mockReset().mockResolvedValue(undefined);
  transcribeLectureSegment.mockReset().mockImplementation(async (input: any) => ({
    transcript: `part ${input.seq}`,
    transcriptText: '[0:00] part 1',
  }));
  useLectureRecordingStore.setState({
    status: 'idle',
    noteId: null,
    startedAt: null,
    pausedAt: null,
    pausedTotalMs: 0,
    segments: [],
    sessionId: null,
    inFlight: 0,
    committedTranscript: '',
    interimTranscript: '',
    whisperTranscript: '',
    transcriptNoteId: null,
    canRetryTranscription: false,
  });
});

afterEach(async () => {
  // A test that ends mid-lecture leaves the store's one-second tick running,
  // which jest reports as a worker that would not exit. Discard is the store's
  // own way down and clears it.
  if (state().status !== 'idle') await state().discard();
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('rotation', () => {
  it('opens one recording at Start and closes nothing yet', async () => {
    await state().start('note-1', 'Cell biology');
    expect(state().status).toBe('recording');
    expect(createAsync).toHaveBeenCalledTimes(1);
    expect(state().segments).toHaveLength(0);
    expect(state().sessionId).toBeTruthy();
  });

  it('closes a segment every five minutes and opens the next, still recording', async () => {
    await state().start('note-1', 'Cell biology');
    await jest.advanceTimersByTimeAsync(LECTURE_SEGMENT_MS + 1000);
    await flush();

    expect(createAsync).toHaveBeenCalledTimes(2);
    expect(state().status).toBe('recording');
    expect(state().segments.map((row) => row.seq)).toEqual([1]);
    expect(state().segments[0]!.stamp).toBe('0:00');
  });

  it('keeps the clock running straight through the seam', async () => {
    await state().start('note-1', 'Cell biology');
    await jest.advanceTimersByTimeAsync(12 * MIN);
    await flush();
    expect(Math.round(getSessionElapsedMs(state()) / MIN)).toBe(12);
    expect(state().segments.map((row) => row.stamp)).toEqual(['0:00', '5:00']);
  });

  it('does not rotate while paused, and does not bill the pause', async () => {
    await state().start('note-1', 'Cell biology');
    await jest.advanceTimersByTimeAsync(4 * MIN);
    await state().pauseRecording();
    await jest.advanceTimersByTimeAsync(10 * MIN);
    await flush();
    expect(state().segments).toHaveLength(0);
    expect(createAsync).toHaveBeenCalledTimes(1);

    await state().resumeRecording();
    await jest.advanceTimersByTimeAsync(2 * MIN);
    await flush();
    expect(state().segments).toHaveLength(1);
    expect(Math.round(getSessionElapsedMs(state()) / MIN)).toBe(6);
  });
});

describe('uploading during the lecture', () => {
  it('uploads and transcribes a closed segment while recording continues', async () => {
    await state().start('note-1', 'Cell biology');
    await jest.advanceTimersByTimeAsync(LECTURE_SEGMENT_MS + 1000);
    await flush();

    expect(prepareLectureSegmentUpload).toHaveBeenCalledTimes(1);
    expect(uploadLectureSegment).toHaveBeenCalledTimes(1);
    expect(transcribeLectureSegment).toHaveBeenCalledTimes(1);
    expect(state().status).toBe('recording');
    expect(state().segments[0]!.status).toBe('done');
    expect(state().segments[0]!.transcript).toBe('part 1');
  });

  it('sends the take id and the segment’s place, which is the idempotency key', async () => {
    await state().start('note-1', 'Cell biology');
    await jest.advanceTimersByTimeAsync(LECTURE_SEGMENT_MS + 1000);
    await flush();
    const sent = transcribeLectureSegment.mock.calls[0]![0] as any;
    expect(sent.noteId).toBe('note-1');
    expect(sent.sessionId).toBe(state().sessionId);
    expect(sent.seq).toBe(1);
    expect(sent.startOffsetMs).toBe(0);
  });

  it('deletes a segment’s cache file only once the server has its words', async () => {
    await state().start('note-1', 'Cell biology');
    await jest.advanceTimersByTimeAsync(LECTURE_SEGMENT_MS + 1000);
    await flush();
    expect(deletedFiles).toHaveLength(1);

    // A failure keeps the file: that is what the per-segment Retry uses.
    deletedFiles.length = 0;
    transcribeLectureSegment.mockRejectedValueOnce(new Error('offline'));
    await jest.advanceTimersByTimeAsync(LECTURE_SEGMENT_MS + 1000);
    await flush();
    expect(deletedFiles).toHaveLength(0);
    expect(state().segments[1]!.status).toBe('failed');
  });

  it('skips the upload when the server already has that segment’s words', async () => {
    prepareLectureSegmentUpload.mockImplementation(async (input: any) => ({
      storagePath: 'u1/x.m4a',
      signedUrl: 'https://upload.example/x',
      token: 'tok',
      bucket: 'note-files',
      mimeType: 'audio/mp4',
      fileName: `lecture-${input.seq}.m4a`,
      attachmentId: 'att-1',
      alreadyTranscribed: true,
    }));
    await state().start('note-1', 'Cell biology');
    await jest.advanceTimersByTimeAsync(LECTURE_SEGMENT_MS + 1000);
    await flush();
    expect(uploadLectureSegment).not.toHaveBeenCalled();
    expect(transcribeLectureSegment).toHaveBeenCalledTimes(1);
  });

  it('fails one segment alone and keeps the microphone open', async () => {
    transcribeLectureSegment.mockRejectedValueOnce(new Error('Network died'));
    await state().start('note-1', 'Cell biology');
    await jest.advanceTimersByTimeAsync(11 * MIN);
    await flush();
    expect(state().status).toBe('recording');
    expect(state().segments[0]!.status).toBe('failed');
    expect(state().segments[1]!.status).toBe('done');
  });
});

describe('stopping, naming and the final segment', () => {
  it('prices the final segment on its own length, not on the whole take', async () => {
    await state().start('note-1', 'Cell biology');
    // Two rotations, then two more minutes.
    await jest.advanceTimersByTimeAsync(12 * MIN);
    await flush();
    await state().stopForTitle();
    await flush();
    expect(state().status).toBe('naming');

    await state().confirmTitleAndTranscribe('Cell biology');
    await flush();

    const finalCall = transcribeLectureSegment.mock.calls.at(-1)![0] as any;
    expect(finalCall.seq).toBe(3);
    // Around two minutes, NEVER the twelve the take ran: sending the elapsed
    // time here would re-buy the whole lecture at the end of it.
    expect(finalCall.durationMs).toBeLessThan(3 * MIN);
    expect(finalCall.durationMs).toBeGreaterThan(MIN);
  });

  it('lands idle with the transcript when every segment is done', async () => {
    await state().start('note-1', 'Cell biology');
    await jest.advanceTimersByTimeAsync(2 * MIN);
    await state().stopForTitle();
    await flush();
    await state().confirmTitleAndTranscribe();
    await flush();
    expect(state().status).toBe('idle');
    expect(toasts.some((row) => row.message === 'Transcript ready')).toBe(true);
  });

  it('holds at "failed" with Retry offered when a part did not transcribe', async () => {
    transcribeLectureSegment.mockRejectedValue(new Error('offline'));
    await state().start('note-1', 'Cell biology');
    await jest.advanceTimersByTimeAsync(2 * MIN);
    await state().stopForTitle();
    await flush();
    await state().confirmTitleAndTranscribe();
    await flush();
    expect(state().status).toBe('failed');
    expect(state().canRetryTranscription).toBe(true);
    expect(toasts.some((row) => /did not transcribe/.test(row.message))).toBe(true);
  });
});

describe('resume from the server', () => {
  const serverRows = () => [
    {
      id: 'att-1',
      type: 'audio',
      fileName: 'lecture-note-1-1.m4a',
      extractedText: 'part one',
      createdAt: '2026-09-18T09:00:00.000Z',
      metadata: {
        lectureSegment: {
          sessionId: 'sA',
          seq: 1,
          startOffsetMs: 0,
          durationMs: 5 * MIN,
          status: 'done',
        },
      },
    },
    {
      id: 'att-2',
      type: 'audio',
      fileName: 'lecture-note-1-2.m4a',
      createdAt: '2026-09-18T09:05:00.000Z',
      metadata: {
        lectureSegment: {
          sessionId: 'sA',
          seq: 2,
          startOffsetMs: 5 * MIN,
          durationMs: 5 * MIN,
          status: 'pending',
        },
      },
    },
  ];

  it('reads a take this phone never finished off the note itself', () => {
    state().hydrateFromNote('note-1', serverRows());
    expect(state().sessionId).toBe('sA');
    expect(state().segments.map((row) => row.status)).toEqual(['done', 'failed']);
    expect(state().segments[0]!.transcript).toBe('part one');
  });

  it('carries on into the SAME take, with the clock where the lecture left off', async () => {
    state().hydrateFromNote('note-1', serverRows());
    await state().start('note-1', 'Cell biology', {
      resume: { sessionId: 'sA', nextSeq: 3, recordedMs: 10 * MIN },
    });
    await jest.advanceTimersByTimeAsync(LECTURE_SEGMENT_MS + 1000);
    await flush();

    expect(state().sessionId).toBe('sA');
    const sent = transcribeLectureSegment.mock.calls.at(-1)![0] as any;
    expect(sent.sessionId).toBe('sA');
    expect(sent.seq).toBe(3);
    expect(sent.startOffsetMs).toBe(10 * MIN);
  });

  it('transcribes an untranscribed segment without re-uploading anything', async () => {
    state().hydrateFromNote('note-1', serverRows());
    useLectureRecordingStore.setState({ noteId: 'note-1' });
    await state().retrySegment(2);
    await flush();
    expect(uploadLectureSegment).not.toHaveBeenCalled();
    expect((transcribeLectureSegment.mock.calls[0]![0] as any).seq).toBe(2);
    expect(state().segments[1]!.status).toBe('done');
  });

  it('offers nothing for a note with no segments', () => {
    state().hydrateFromNote('note-1', []);
    expect(state().segments).toEqual([]);
    expect(state().sessionId).toBeNull();
  });
});
