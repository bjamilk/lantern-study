import { describe, expect, it } from 'vitest';
import {
  LECTURE_CONSENT_LINE,
  applyLectureNoteStamp,
  buildLectureAsk,
  composeLectureNoteBody,
  displayLectureTranscript,
  elapsedRecordingMs,
  formatLectureClock,
  lectureTimestampMarker,
  latestLectureTranscript,
  mergeCaptionStream,
  newLectureNoteTitle,
  pausedTotalAfterResume,
  preferLectureTranscript,
  resolveLectureStudioNote,
  shouldCreateLectureNote,
  shouldDeleteDoorNoteOnDiscard,
  splitLectureNoteBody,
  typedNotesFromBody,
} from './lectureStudio';

describe('lecture studio helpers', () => {
  it('names a lecture note for the day it was recorded', () => {
    expect(newLectureNoteTitle(new Date(2026, 8, 6))).toBe('Lecture — 6 Sep');
    expect(newLectureNoteTitle(new Date(2026, 0, 31))).toBe('Lecture — 31 Jan');
  });

  it('keeps the consent line as one plain sentence', () => {
    expect(LECTURE_CONSENT_LINE).toBe(
      'Recording is stored in your note; ask before recording other people.'
    );
  });

  it('formats the fuchsia timer as m:ss', () => {
    expect(formatLectureClock(0)).toBe('0:00');
    expect(formatLectureClock(3_000)).toBe('0:03');
    expect(formatLectureClock(62_000)).toBe('1:02');
    expect(lectureTimestampMarker(62_000)).toBe('[1:02]');
  });

  it('excludes paused time from the recorded clock', () => {
    const start = 1_000_000;
    expect(elapsedRecordingMs({ startedAt: null, pausedTotalMs: 0, pausedAt: null }, start)).toBe(0);
    expect(
      elapsedRecordingMs({ startedAt: start, pausedTotalMs: 0, pausedAt: start + 30_000 }, start + 90_000)
    ).toBe(30_000);
    expect(
      elapsedRecordingMs({ startedAt: start, pausedTotalMs: 600_000, pausedAt: null }, start + 660_000)
    ).toBe(60_000);
    expect(pausedTotalAfterResume(0, start, start + 5_000)).toBe(5_000);
  });

  it('stamps a new paragraph and the first keystroke, not mid-line edits', () => {
    expect(applyLectureNoteStamp('', 'Enzymes', 0)).toBe('[0:00] Enzymes');
    expect(applyLectureNoteStamp('[0:00] Enzymes', '[0:00] Enzymes\nlower', 12_000)).toBe(
      '[0:00] Enzymes\n[0:12] lower'
    );
    expect(applyLectureNoteStamp('[0:00] En', '[0:00] Enz', 5_000)).toBe('[0:00] Enz');
    expect(applyLectureNoteStamp('[0:00] Enz', '[0:00] En', 5_000)).toBe('[0:00] En');
  });

  it('quotes what was just said so Ask does not need the lecture to stop', () => {
    const message = buildLectureAsk({
      recentTranscript: 'Enzymes lower activation energy.',
      noteTitle: 'Lecture — 6 Sep',
      elapsedMs: 90_000,
    });
    expect(message).toContain('What was just said?');
    expect(message).toContain('in "Lecture — 6 Sep"');
    expect(message).toContain('[1:30]');
    expect(message).toContain('Enzymes lower activation energy.');
    expect(buildLectureAsk({ noteTitle: 'Lecture — 6 Sep' })).toContain('no transcript yet');
  });

  it('merges interim captions into the live display without dropping finals', () => {
    const first = mergeCaptionStream({
      committed: 'Hello',
      incomingFinals: ['class'],
      interim: 'today',
    });
    expect(first.committed).toBe('Hello class');
    expect(first.display).toBe('Hello class today');
    expect(
      displayLectureTranscript({
        committed: 'Hello class',
        interim: 'today',
        whisper: 'Earlier hour.',
      })
    ).toContain('Earlier hour.');
  });

  it('resumes the selected or dated lecture instead of creating a second empty note', () => {
    const lectures = [
      { id: 'old', title: 'Lecture — 5 Sep' },
      { id: 'today', title: 'Lecture — 6 Sep' },
    ];
    expect(
      resolveLectureStudioNote({
        lectures,
        selectedNoteId: 'old',
        todayTitle: 'Lecture — 6 Sep',
      })
    ).toEqual({ action: 'resume', noteId: 'old' });
    expect(
      resolveLectureStudioNote({
        lectures,
        selectedNoteId: 'typed-note',
        todayTitle: 'Lecture — 6 Sep',
      })
    ).toEqual({ action: 'resume', noteId: 'today' });
    expect(
      resolveLectureStudioNote({
        lectures: [],
        todayTitle: 'Lecture — 6 Sep',
      })
    ).toEqual({ action: 'create', title: 'Lecture — 6 Sep' });
    expect(
      resolveLectureStudioNote({
        lectures,
        recordingNoteId: 'live',
        todayTitle: 'Lecture — 6 Sep',
      })
    ).toEqual({ action: 'resume', noteId: 'live' });
  });

  it('does not write a lecture note until the student confirms', () => {
    expect(shouldCreateLectureNote(true)).toBe(true);
    expect(shouldCreateLectureNote(false)).toBe(false);
  });

  it('only deletes the door shell when discard finds it still empty', () => {
    expect(
      shouldDeleteDoorNoteOnDiscard({
        openedByDoor: true,
        title: 'Lecture — 6 Sep',
        body: '',
        doorTitle: 'Lecture — 6 Sep',
      })
    ).toBe(true);
    expect(
      shouldDeleteDoorNoteOnDiscard({
        openedByDoor: true,
        title: 'Lecture — 6 Sep',
        body: '[0:00] a note',
        doorTitle: 'Lecture — 6 Sep',
      })
    ).toBe(false);
    expect(
      shouldDeleteDoorNoteOnDiscard({
        openedByDoor: false,
        title: 'Lecture — 6 Sep',
        body: '',
        doorTitle: 'Lecture — 6 Sep',
      })
    ).toBe(false);
  });

  it('splits Whisper text back off the typed notes', () => {
    expect(typedNotesFromBody('[0:00] mine\n\nThe lecture said this.', 'The lecture said this.')).toBe(
      '[0:00] mine'
    );
    expect(latestLectureTranscript([{ extractedText: 'one' }, { extractedText: 'two' }])).toBe('two');
  });

  it('writes captions into the note under a Transcript heading', () => {
    expect(composeLectureNoteBody('[0:00] mine', 'Enzymes lower activation energy.')).toBe(
      '[0:00] mine\n\nTranscript\n\nEnzymes lower activation energy.'
    );
    expect(
      splitLectureNoteBody('[0:00] mine\n\nTranscript\n\nEnzymes lower activation energy.')
    ).toEqual({
      typed: '[0:00] mine',
      transcript: 'Enzymes lower activation energy.',
    });
    expect(preferLectureTranscript('Hello class', '')).toBe('Hello class');
    expect(preferLectureTranscript('', 'Hello class')).toBe('Hello class');
  });

  it('treats captions-only door notes as empty on discard', () => {
    expect(
      shouldDeleteDoorNoteOnDiscard({
        openedByDoor: true,
        title: 'Lecture — 6 Sep',
        body: 'Transcript\n\nHello class',
        doorTitle: 'Lecture — 6 Sep',
      })
    ).toBe(true);
  });
});
