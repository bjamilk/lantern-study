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
    expect(
      latestLectureTranscript([{ type: 'pdf', extractedText: 'slide text that is not captions' }])
    ).toBe('');
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

import {
  SMART_NOTES_END,
  SMART_NOTES_HEADING,
  SMART_NOTES_START,
  upsertSmartNotesSection,
} from '../utils/smartNotes';
import {
  defaultLectureTab,
  formatLectureAudioTime,
  lectureAudioAttachment,
  lectureAudioFileName,
  lectureNoteParts,
  lectureTabs,
  lectureTranscriptLines,
  nextLectureAudioSpeed,
  resolveLectureTab,
  showLectureConsentGate,
} from './lectureStudio';

const TYPED = '[0:00] mine';
const TRANSCRIPT = 'Enzymes lower activation energy.';
const ENHANCED = '- Enzymes cut the activation barrier.';

const withEnhanced = (body: string) =>
  `${body}\n\n${SMART_NOTES_START}\n${SMART_NOTES_HEADING}\n\n${ENHANCED}\n${SMART_NOTES_END}\n`;

const audioRow = {
  id: 'att-audio',
  type: 'audio',
  fileUrl: 'https://example.test/lecture.webm?token=abc',
  fileName: 'lecture.webm',
  extractedText: TRANSCRIPT,
};

const tabIds = (source: Parameters<typeof lectureTabs>[0]) =>
  lectureTabs(source).map((tab) => tab.id);

describe('lecture tab planner', () => {
  it('gives a bare note only My Notes', () => {
    expect(tabIds({ body: 'Just what I typed.' })).toEqual(['notes']);
    expect(tabIds({})).toEqual(['notes']);
    expect(lectureTabs({}).map((tab) => tab.label)).toEqual(['My Notes']);
  });

  it('can keep the Transcript tab open before captions exist', () => {
    expect(tabIds({ body: 'Just what I typed.', showTranscriptTab: true })).toEqual([
      'notes',
      'transcript',
    ]);
  });

  it('opens each tab from its own source and all four together', () => {
    const body = composeLectureNoteBody(TYPED, TRANSCRIPT);
    expect(tabIds({ body: withEnhanced(TYPED) })).toEqual(['notes', 'enhanced']);
    expect(tabIds({ body })).toEqual(['notes', 'transcript']);
    expect(tabIds({ body: TYPED, attachments: [{ extractedText: TRANSCRIPT }] })).toEqual([
      'notes',
      'transcript',
    ]);
    expect(tabIds({ body: TYPED, attachments: [audioRow] })).toEqual([
      'notes',
      'transcript',
      'audio',
    ]);
    expect(tabIds({ body: withEnhanced(body), attachments: [audioRow] })).toEqual([
      'notes',
      'enhanced',
      'transcript',
      'audio',
    ]);
  });

  it('offers Materials beside Enhanced when a document or video is attached', () => {
    expect(tabIds({ attachments: [{ type: 'pdf', fileUrl: 'x' }] })).toEqual(['notes', 'materials']);
    expect(tabIds({ sourceType: 'youtube', youtubeVideoId: 'abc' })).toEqual(['notes', 'materials']);
    expect(tabIds({ body: TYPED, showEnhancedTab: true })).toEqual(['notes', 'enhanced']);
    expect(
      tabIds({
        body: withEnhanced(composeLectureNoteBody(TYPED, TRANSCRIPT)),
        attachments: [audioRow, { type: 'pdf', fileUrl: 'x' }],
      })
    ).toEqual(['notes', 'enhanced', 'materials', 'transcript', 'audio']);
  });

  it('opens a document note on Materials, and Enhanced once Smart Notes exist', () => {
    const pdf = { sourceType: 'pdf' as const, attachments: [{ type: 'pdf', fileUrl: 'x' }] };
    expect(defaultLectureTab(pdf)).toBe('materials');
    expect(defaultLectureTab({ ...pdf, body: withEnhanced(TYPED) })).toBe('enhanced');
  });

  it('counts a recording whose signed URL failed but whose storage path was kept', () => {
    const unsigned = {
      id: 'att-2',
      type: 'audio',
      fileName: 'lecture.webm',
      metadata: { storagePath: 'user/lecture.webm' },
    };
    expect(tabIds({ body: TYPED, attachments: [unsigned] })).toEqual(['notes', 'audio']);
    expect(lectureAudioAttachment({ attachments: [unsigned] })).toBe(unsigned);
    // No URL and no path is not a playable row, so it opens no tab.
    expect(tabIds({ body: TYPED, attachments: [{ id: 'att-3', type: 'audio' }] })).toEqual([
      'notes',
    ]);
    // A PDF is never the lecture's audio.
    expect(
      lectureAudioAttachment({ attachments: [{ id: 'p', type: 'pdf', fileUrl: 'x' }] })
    ).toBeNull();
    // Newest recording wins when a note was recorded into twice.
    expect(lectureAudioAttachment({ attachments: [audioRow, unsigned] })).toBe(unsigned);
  });

  it('keeps the generated section out of the transcript and the typed notes', () => {
    const parts = lectureNoteParts({
      body: withEnhanced(composeLectureNoteBody(TYPED, TRANSCRIPT)),
      attachments: [audioRow],
    });
    expect(parts.typed).toBe(TYPED);
    expect(parts.transcript).toBe(TRANSCRIPT);
    expect(parts.enhanced).toBe(ENHANCED);
    expect(parts.transcript).not.toContain('Enzymes cut');
    expect(parts.typed).not.toContain('Transcript');
  });

  it('counts live captions as a transcript before anything is saved', () => {
    expect(tabIds({ body: TYPED, liveTranscript: 'Listening now' })).toEqual([
      'notes',
      'transcript',
    ]);
    expect(lectureNoteParts({ body: TYPED, liveTranscript: '   ' }).transcript).toBe('');
  });

  it('opens on the enhanced notes when they exist, and on My Notes otherwise', () => {
    expect(defaultLectureTab({ body: withEnhanced(TYPED) })).toBe('enhanced');
    expect(defaultLectureTab({ body: composeLectureNoteBody(TYPED, TRANSCRIPT) })).toBe('notes');
    expect(defaultLectureTab({})).toBe('notes');
  });

  it('pins the pane to My Notes while a take is running', () => {
    const source = { body: withEnhanced(TYPED), attachments: [audioRow] };
    expect(defaultLectureTab(source, { recording: true })).toBe('notes');
    expect(resolveLectureTab(source, 'audio', { recording: true })).toBe('notes');
    expect(resolveLectureTab(source, 'audio')).toBe('audio');
  });

  it('drops a chosen tab that the note no longer has', () => {
    expect(resolveLectureTab({ body: TYPED }, 'audio')).toBe('notes');
    expect(resolveLectureTab({ body: withEnhanced(TYPED) }, 'transcript')).toBe('enhanced');
    expect(resolveLectureTab({ body: TYPED }, null)).toBe('notes');
  });

  it('lifts a gutter time off a caption line and leaves plain lines alone', () => {
    expect(lectureTranscriptLines('[0:12] Entropy rises.\nNo stamp here.\n\n[1:04]\n')).toEqual([
      { time: '0:12', text: 'Entropy rises.' },
      { text: 'No stamp here.' },
    ]);
    expect(lectureTranscriptLines('12:04:09 long lecture')).toEqual([
      { time: '12:04:09', text: 'long lecture' },
    ]);
    expect(lectureTranscriptLines('')).toEqual([]);
  });

  it('cycles the playback speed and formats a playhead', () => {
    expect(nextLectureAudioSpeed(1)).toBe(1.25);
    expect(nextLectureAudioSpeed(1.25)).toBe(1.5);
    expect(nextLectureAudioSpeed(1.5)).toBe(1);
    expect(nextLectureAudioSpeed(9)).toBe(1);
    expect(formatLectureAudioTime(0)).toBe('0:00');
    expect(formatLectureAudioTime(75.4)).toBe('1:15');
    expect(formatLectureAudioTime(Number.NaN)).toBe('0:00');
    expect(lectureAudioFileName(audioRow)).toBe('lecture.webm');
    expect(lectureAudioFileName({ type: 'audio' })).toBe('lecture-recording');
  });
});


/**
 * The Android studio showed no tab row at all on build 193: its consent gate
 * replaced the whole surface whenever the recorder was idle, so a saved lecture
 * — enhanced notes and all — was unreachable. These pin both halves: the
 * planner really does find the tabs in a body written the way the app writes
 * one, and the gate stands aside for a lecture that has something to read.
 */
describe('a saved lecture, written the way the app writes it', () => {
  /** Exactly what the studio saves: transcript into the body, then enhance. */
  const savedBody = upsertSmartNotesSection(
    composeLectureNoteBody(TYPED, TRANSCRIPT),
    ENHANCED
  );

  it('plans three tabs from the stored body, four once audio is attached', () => {
    expect(tabIds({ body: savedBody })).toEqual(['notes', 'enhanced', 'transcript']);
    expect(tabIds({ body: savedBody, attachments: [audioRow] })).toEqual([
      'notes',
      'enhanced',
      'transcript',
      'audio',
    ]);
    const parts = lectureNoteParts({ body: savedBody });
    expect(parts.typed).toBe(TYPED);
    expect(parts.enhanced).toBe(ENHANCED);
    expect(parts.transcript).toBe(TRANSCRIPT);
  });

  it('opens the lecture instead of the consent door when there is something to read', () => {
    const idle = { consented: false, idle: true };
    expect(showLectureConsentGate({ ...idle, source: { body: savedBody } })).toBe(false);
    expect(showLectureConsentGate({ ...idle, source: { body: 'Just what I typed.' } })).toBe(
      false
    );
    expect(showLectureConsentGate({ ...idle, source: { attachments: [audioRow] } })).toBe(false);
  });

  it('still asks before a lecture that has nothing on it yet', () => {
    expect(showLectureConsentGate({ source: {}, consented: false, idle: true })).toBe(true);
    expect(showLectureConsentGate({ source: { body: '   ' }, consented: false, idle: true })).toBe(
      true
    );
    // Already agreed, or a take already running: never in the way.
    expect(showLectureConsentGate({ source: {}, consented: true, idle: true })).toBe(false);
    expect(showLectureConsentGate({ source: {}, consented: false, idle: false })).toBe(false);
  });
});
