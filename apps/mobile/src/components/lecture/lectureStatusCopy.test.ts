/**
 * Both of these are claims a student reads as fact while their lecture is at
 * stake, so every assertion here is about a sentence, not a shape.
 */
import {
  AUDIO_HELD_COPY,
  classifyLectureFailure,
  isOtherNoteHoldingLecture,
  isOtherNoteRecording,
  lectureFailureLine,
  recordCardBlockedReason,
  type LectureCopyStatus,
} from './lectureStatusCopy';

describe('classifyLectureFailure', () => {
  it('reads the transport errors a dropped connection produces', () => {
    expect(classifyLectureFailure('Network request failed')).toBe('offline');
    expect(classifyLectureFailure('TypeError: Failed to fetch')).toBe('offline');
    expect(classifyLectureFailure('getaddrinfo ENOTFOUND api.lanternstudy.com')).toBe('offline');
  });

  it('reads an abort, a cancel and a timeout as one interruption', () => {
    expect(classifyLectureFailure('AbortError: Aborted')).toBe('interrupted');
    expect(classifyLectureFailure('Transcription cancelled. The recording is still here.')).toBe(
      'interrupted'
    );
    expect(classifyLectureFailure('The request timed out')).toBe('interrupted');
  });

  it('invents nothing for an error it does not recognise', () => {
    expect(classifyLectureFailure('500 Internal Server Error')).toBe('unknown');
    expect(classifyLectureFailure('')).toBe('unknown');
    expect(classifyLectureFailure(null)).toBe('unknown');
    expect(classifyLectureFailure(undefined)).toBe('unknown');
  });
});

describe('lectureFailureLine', () => {
  it('separates the reason from the promise instead of running them together', () => {
    // The device bug, verbatim: "Network request failed The audio is still here"
    expect(lectureFailureLine('Network request failed')).toBe(`No connection. ${AUDIO_HELD_COPY}`);
    expect(lectureFailureLine('AbortError')).toBe(`The upload was interrupted. ${AUDIO_HELD_COPY}`);
  });

  it('never shows the raw error', () => {
    const line = lectureFailureLine('Network request failed');
    expect(line).not.toContain('Network request failed');
  });

  it('falls back to the promise alone when the reason is unknown', () => {
    expect(lectureFailureLine('502 Bad Gateway')).toBe(AUDIO_HELD_COPY);
    expect(lectureFailureLine(null)).toBe(AUDIO_HELD_COPY);
  });
});

describe('isOtherNoteRecording', () => {
  const base = { activeNoteId: 'note-b', noteId: 'note-a' as string };

  it('is true only while another note is actually capturing', () => {
    expect(isOtherNoteRecording({ ...base, status: 'recording' })).toBe(true);
    expect(isOtherNoteRecording({ ...base, status: 'recording', paused: true })).toBe(true);
  });

  it('is false for every state in which nothing is being recorded', () => {
    const quiet: LectureCopyStatus[] = ['idle', 'naming', 'uploading', 'transcribing', 'failed'];
    for (const status of quiet) {
      expect(isOtherNoteRecording({ ...base, status })).toBe(false);
    }
  });

  it('never calls this note itself "another note"', () => {
    // The device defect: after the second stop the note's own session sat in
    // `naming`/`failed` and its own card said another note was recording.
    const own: LectureCopyStatus[] = ['recording', 'naming', 'uploading', 'transcribing', 'failed'];
    for (const status of own) {
      expect(isOtherNoteRecording({ status, activeNoteId: 'note-a', noteId: 'note-a' })).toBe(false);
    }
  });
});

describe('isOtherNoteHoldingLecture', () => {
  const base = { activeNoteId: 'note-b', noteId: 'note-a' as string };

  it('covers the unfinished states, but not recording or idle', () => {
    expect(isOtherNoteHoldingLecture({ ...base, status: 'naming' })).toBe(true);
    expect(isOtherNoteHoldingLecture({ ...base, status: 'uploading' })).toBe(true);
    expect(isOtherNoteHoldingLecture({ ...base, status: 'transcribing' })).toBe(true);
    expect(isOtherNoteHoldingLecture({ ...base, status: 'failed' })).toBe(true);
    expect(isOtherNoteHoldingLecture({ ...base, status: 'recording' })).toBe(false);
    expect(isOtherNoteHoldingLecture({ ...base, status: 'idle' })).toBe(false);
  });
});

describe('recordCardBlockedReason', () => {
  it('says nothing when nothing is happening', () => {
    expect(
      recordCardBlockedReason({ status: 'idle', activeNoteId: null, noteId: 'note-a' })
    ).toBeNull();
  });

  it('describes this note from this note, and never as "another"', () => {
    expect(
      recordCardBlockedReason({ status: 'recording', activeNoteId: 'note-a', noteId: 'note-a' })
    ).toBe('Recording — controls are above');
    expect(
      recordCardBlockedReason({ status: 'naming', activeNoteId: 'note-a', noteId: 'note-a' })
    ).toBe('Name the recording you just stopped');
    expect(
      recordCardBlockedReason({ status: 'failed', activeNoteId: 'note-a', noteId: 'note-a' })
    ).toBe('Retry or discard your last recording');
    expect(
      recordCardBlockedReason({ status: 'uploading', activeNoteId: 'note-a', noteId: 'note-a' })
    ).toBe('Finishing the last recording');
  });

  it('separates another note recording from another note finishing', () => {
    expect(
      recordCardBlockedReason({ status: 'recording', activeNoteId: 'note-b', noteId: 'note-a' })
    ).toBe('Another note is recording');
    expect(
      recordCardBlockedReason({ status: 'failed', activeNoteId: 'note-b', noteId: 'note-a' })
    ).toBe('Another note is finishing a recording');
  });
});
