// @vitest-environment jsdom
/**
 * The segmented recorder, driven without a microphone.
 *
 * What is asserted here is the behaviour a student would only discover by
 * sitting through a 50-minute lecture and then crashing the tab:
 *
 *  - the recorder ROTATES on recorded time, so a segment closes every five
 *    minutes and the clock runs straight through the seam;
 *  - a closed segment is uploaded and transcribed WHILE the lecture carries on,
 *    on the same microphone stream (the stream is never reopened);
 *  - a pause neither rotates nor advances the clock;
 *  - one refused segment fails alone, keeps its audio, and can be retried
 *    without touching the rest;
 *  - a reload finds the take on the SERVER and can carry on into the same
 *    sequence.
 *
 * `MediaRecorder` and `getUserMedia` are stood up as fakes rather than mocked
 * away: the rotation is a dance between the store's clock and the recorder's
 * `stop`/`onstop`, and a mock that resolves instantly would not test it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prepareLectureSegmentUpload = vi.fn();
const uploadLectureSegment = vi.fn();
const transcribeLectureSegment = vi.fn();

vi.mock('../services/notes', () => ({
  prepareLectureSegmentUpload: (...args: unknown[]) => prepareLectureSegmentUpload(...args),
  uploadLectureSegment: (...args: unknown[]) => uploadLectureSegment(...args),
  transcribeLectureSegment: (...args: unknown[]) => transcribeLectureSegment(...args),
}));
vi.mock('../services/ai', () => ({ fetchAIUsage: vi.fn() }));
vi.mock('./notesStore', () => ({
  useNotesStore: { getState: () => ({ notes: [], selectedNote: null, setNotes: vi.fn(), setSelectedNote: vi.fn() }) },
}));
const toasts: Array<{ message: string; kind: string }> = [];
vi.mock('./toastStore', () => ({
  useToastStore: {
    getState: () => ({
      showToast: (message: string, kind: string) => toasts.push({ message, kind }),
    }),
  },
}));

import { useLectureRecordingStore, getSessionElapsedMs } from './lectureRecordingStore';
import { LECTURE_SEGMENT_MS } from '@lantern/shared/utils/lectureSegments';

const MIN = 60_000;

/** Every recorder this test's store has built, oldest first. */
let recorders: FakeRecorder[] = [];
let stopTrackCalls = 0;

class FakeRecorder {
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public stream: unknown, public options?: unknown) {
    recorders.push(this);
  }

  static isTypeSupported() {
    return true;
  }

  start() {
    this.state = 'recording';
    // A real recorder flushes its first chunk almost at once; the store waits
    // for one before it builds the blob.
    this.ondataavailable?.({ data: new Blob(['x'.repeat(4096)]) });
  }

  stop() {
    this.state = 'inactive';
    this.onstop?.();
  }

  pause() {
    this.state = 'paused';
  }

  resume() {
    this.state = 'recording';
  }
}

function installBrowser() {
  recorders = [];
  stopTrackCalls = 0;
  (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [
          {
            stop: () => {
              stopTrackCalls += 1;
            },
          },
        ],
      })),
    },
  });
}

/** Let the store's un-awaited segment work settle. */
async function flush(times = 8) {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  }
}

const state = () => useLectureRecordingStore.getState();

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-18T09:00:00.000Z'));
  installBrowser();
  toasts.length = 0;
  prepareLectureSegmentUpload.mockReset().mockImplementation(async (input: any) => ({
    storagePath: `u1/lecture-${input.noteId}-${input.seq}.webm`,
    signedUrl: 'https://upload.example/x',
    token: 'tok',
    bucket: 'note-files',
    mimeType: 'audio/webm',
    fileName: `lecture-${input.noteId}-${input.seq}.webm`,
    attachmentId: `att-${input.seq}`,
    alreadyTranscribed: false,
  }));
  uploadLectureSegment.mockReset().mockResolvedValue(undefined);
  transcribeLectureSegment.mockReset().mockImplementation(async (input: any) => ({
    transcript: `part ${input.seq}`,
    transcriptText: `[0:00] part 1`,
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
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('rotation', () => {
  it('opens one recorder at Start and closes nothing yet', async () => {
    await state().start('note-1', 'Cell biology');
    expect(state().status).toBe('recording');
    expect(recorders).toHaveLength(1);
    expect(state().segments).toHaveLength(0);
    expect(state().sessionId).toBeTruthy();
  });

  it('closes a segment every five minutes and arms the next on the SAME stream', async () => {
    await state().start('note-1', 'Cell biology');
    const stream = recorders[0]!.stream;

    await vi.advanceTimersByTimeAsync(LECTURE_SEGMENT_MS + 1000);
    await flush();

    expect(recorders).toHaveLength(2);
    // The microphone was never reopened: same stream, new encoder. Reopening
    // would re-prompt on some browsers and drop a second of the lecture.
    expect(recorders[1]!.stream).toBe(stream);
    expect(stopTrackCalls).toBe(0);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(state().status).toBe('recording');
    expect(state().segments.map((row) => row.seq)).toEqual([1]);
    expect(state().segments[0]!.stamp).toBe('0:00');
  });

  it('keeps the clock running straight through the seam', async () => {
    await state().start('note-1', 'Cell biology');
    await vi.advanceTimersByTimeAsync(12 * MIN);
    await flush();
    expect(Math.round(getSessionElapsedMs(state()) / MIN)).toBe(12);
    expect(state().segments.map((row) => row.stamp)).toEqual(['0:00', '5:00']);
  });

  /**
   * The stamps are contiguous, not round.
   *
   * The boundary is checked once a second, so a segment can run a second past
   * five minutes before it closes — and the NEXT one then starts at 10:01
   * rather than 10:00. That is the honest number: the stamp says where the
   * audio actually is. What must never drift is the join, because a gap or an
   * overlap between two offsets would make every later stamp point at the wrong
   * moment of the recording.
   */
  it('stamps each segment where its audio actually starts, with no gap at the join', async () => {
    await state().start('note-1', 'Cell biology');
    await vi.advanceTimersByTimeAsync(16 * MIN);
    await flush();

    const segments = state().segments;
    expect(segments).toHaveLength(3);
    let cursor = 0;
    for (const segment of segments) {
      expect(segment.startOffsetMs).toBe(cursor);
      // Never short of the five minutes, never more than a tick over it.
      expect(segment.durationMs).toBeGreaterThanOrEqual(LECTURE_SEGMENT_MS);
      expect(segment.durationMs).toBeLessThan(LECTURE_SEGMENT_MS + 1500);
      cursor += segment.durationMs;
    }
    expect(segments.map((row) => row.stamp)).toEqual(['0:00', '5:00', '10:01']);
  });

  it('does not rotate while paused, and does not bill the pause', async () => {
    await state().start('note-1', 'Cell biology');
    await vi.advanceTimersByTimeAsync(4 * MIN);
    state().pauseRecording();
    // Ten minutes of coffee: two segment lengths of wall clock, no audio.
    await vi.advanceTimersByTimeAsync(10 * MIN);
    await flush();
    expect(state().segments).toHaveLength(0);
    expect(recorders).toHaveLength(1);

    state().resumeRecording();
    await vi.advanceTimersByTimeAsync(2 * MIN);
    await flush();
    // 4 + 2 recorded minutes: the pause never counted toward the boundary.
    expect(state().segments).toHaveLength(1);
    expect(Math.round(getSessionElapsedMs(state()) / MIN)).toBe(6);
  });
});

describe('uploading during the lecture', () => {
  it('uploads and transcribes a closed segment while recording continues', async () => {
    await state().start('note-1', 'Cell biology');
    await vi.advanceTimersByTimeAsync(LECTURE_SEGMENT_MS + 1000);
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
    await vi.advanceTimersByTimeAsync(LECTURE_SEGMENT_MS + 1000);
    await flush();
    const sent = transcribeLectureSegment.mock.calls[0]![0] as any;
    expect(sent.noteId).toBe('note-1');
    expect(sent.sessionId).toBe(state().sessionId);
    expect(sent.seq).toBe(1);
    expect(sent.startOffsetMs).toBe(0);
  });

  it('skips the upload when the server already has that segment’s words', async () => {
    prepareLectureSegmentUpload.mockImplementation(async (input: any) => ({
      storagePath: 'u1/x.webm',
      signedUrl: 'https://upload.example/x',
      token: 'tok',
      bucket: 'note-files',
      mimeType: 'audio/webm',
      fileName: `lecture-${input.seq}.webm`,
      attachmentId: 'att-1',
      alreadyTranscribed: true,
    }));
    await state().start('note-1', 'Cell biology');
    await vi.advanceTimersByTimeAsync(LECTURE_SEGMENT_MS + 1000);
    await flush();
    expect(uploadLectureSegment).not.toHaveBeenCalled();
    expect(transcribeLectureSegment).toHaveBeenCalledTimes(1);
  });

  it('clears the captions at the seam so they never read as a second transcript', async () => {
    await state().start('note-1', 'Cell biology');
    useLectureRecordingStore.setState({ committedTranscript: 'rough words', interimTranscript: 'in' });
    await vi.advanceTimersByTimeAsync(LECTURE_SEGMENT_MS + 1000);
    await flush();
    expect(state().committedTranscript).toBe('');
    expect(state().interimTranscript).toBe('');
  });
});

describe('a segment that fails', () => {
  it('fails alone, keeps recording, and offers a retry on that card', async () => {
    transcribeLectureSegment.mockRejectedValueOnce(new Error('Network died'));
    await state().start('note-1', 'Cell biology');
    await vi.advanceTimersByTimeAsync(11 * MIN);
    await flush();

    expect(state().status).toBe('recording');
    expect(state().segments[0]!.status).toBe('failed');
    expect(state().segments[0]!.error).toContain('Network died');
    // The next segment is unaffected — one refused request is not a lost hour.
    expect(state().segments[1]!.status).toBe('done');
  });

  it('retries only that segment, from the audio this tab still holds', async () => {
    transcribeLectureSegment.mockRejectedValueOnce(new Error('Network died'));
    await state().start('note-1', 'Cell biology');
    await vi.advanceTimersByTimeAsync(LECTURE_SEGMENT_MS + 1000);
    await flush();
    expect(state().segments[0]!.status).toBe('failed');

    const before = transcribeLectureSegment.mock.calls.length;
    state().retrySegment(1);
    await flush();

    expect(transcribeLectureSegment.mock.calls.length).toBe(before + 1);
    expect((transcribeLectureSegment.mock.calls.at(-1)![0] as any).seq).toBe(1);
    expect(state().segments[0]!.status).toBe('done');
  });
});

describe('stopping', () => {
  it('says "Saving your recording…" until the last segment lands', async () => {
    let release!: (value: unknown) => void;
    transcribeLectureSegment.mockImplementationOnce(
      () => new Promise((resolve) => {
        release = resolve;
      })
    );
    await state().start('note-1', 'Cell biology');
    await vi.advanceTimersByTimeAsync(2 * MIN);
    state().stopAndTranscribe();
    await flush();

    expect(state().status).toBe('saving');
    expect(state().inFlight).toBe(1);

    release({ transcript: 'all of it', transcriptText: '[0:00] all of it' });
    await flush();

    expect(state().status).toBe('idle');
    expect(toasts.some((row) => row.message === 'Transcript ready')).toBe(true);
  });

  it('puts the microphone down at Stop, not at the seam', async () => {
    await state().start('note-1', 'Cell biology');
    await vi.advanceTimersByTimeAsync(LECTURE_SEGMENT_MS + 1000);
    await flush();
    expect(stopTrackCalls).toBe(0);

    await vi.advanceTimersByTimeAsync(MIN);
    state().stopAndTranscribe();
    await flush();
    expect(stopTrackCalls).toBe(1);
  });

  it('says which parts still need a retry rather than claiming success', async () => {
    transcribeLectureSegment.mockRejectedValue(new Error('offline'));
    await state().start('note-1', 'Cell biology');
    await vi.advanceTimersByTimeAsync(2 * MIN);
    state().stopAndTranscribe();
    await flush();
    expect(state().status).toBe('idle');
    expect(toasts.some((row) => /did not transcribe/.test(row.message))).toBe(true);
    expect(toasts.some((row) => row.message === 'Transcript ready')).toBe(false);
  });
});

describe('resume from the server', () => {
  const serverRows = (over: Record<string, unknown> = {}) => [
    {
      id: 'att-1',
      type: 'audio',
      fileName: 'lecture-note-1-1.webm',
      extractedText: 'part one',
      createdAt: '2026-09-18T09:00:00.000Z',
      metadata: {
        storagePath: 'u1/lecture-note-1-1.webm',
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
      fileName: 'lecture-note-1-2.webm',
      createdAt: '2026-09-18T09:05:00.000Z',
      metadata: {
        storagePath: 'u1/lecture-note-1-2.webm',
        lectureSegment: {
          sessionId: 'sA',
          seq: 2,
          startOffsetMs: 5 * MIN,
          durationMs: 5 * MIN,
          status: 'pending',
          ...over,
        },
      },
    },
  ];

  it('reads a take this tab never finished off the note itself', () => {
    state().hydrateFromNote('note-1', serverRows());
    expect(state().sessionId).toBe('sA');
    expect(state().segments.map((row) => row.status)).toEqual(['done', 'failed']);
    expect(state().segments[0]!.transcript).toBe('part one');
    expect(state().segments[1]!.attachmentId).toBe('att-2');
  });

  it('carries on into the SAME take, with the clock where the lecture left off', async () => {
    state().hydrateFromNote('note-1', serverRows());
    await state().start('note-1', 'Cell biology', {
      resume: { sessionId: 'sA', nextSeq: 3, recordedMs: 10 * MIN },
    });
    await vi.advanceTimersByTimeAsync(LECTURE_SEGMENT_MS + 1000);
    await flush();

    expect(state().sessionId).toBe('sA');
    const sent = transcribeLectureSegment.mock.calls.at(-1)![0] as any;
    expect(sent.sessionId).toBe('sA');
    expect(sent.seq).toBe(3);
    // Segment 3 starts at minute 10, not at zero — the stamps stay true to the
    // lecture rather than to this browser session.
    expect(sent.startOffsetMs).toBe(10 * MIN);
    expect(state().segments.find((row) => row.seq === 3)!.stamp).toBe('10:00');
  });

  it('transcribes an untranscribed segment without re-uploading anything', async () => {
    state().hydrateFromNote('note-1', serverRows());
    useLectureRecordingStore.setState({ noteId: 'note-1' });
    state().retrySegment(2);
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
