import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  SMART_NOTES_END,
  SMART_NOTES_HEADING,
  SMART_NOTES_START,
} from '@lantern/shared/utils/smartNotes';
import { LectureStudio } from './LectureStudio';
import { NoteReadingView } from './NoteReadingView';

/** The reading state the lecture studio's "My notes" pane opens in. */
const render = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);
const visibleText = (html: string) => html.replace(/<[^>]*>/g, '');

const LECTURE = `[00:36] Professor starts on entropy
Second law: disorder never falls.

## After class
- Read chapter 4`;

describe('LectureStudio reading view', () => {
  it('tones a transcript timestamp as a caption inside a body paragraph', () => {
    const html = render(<NoteReadingView body={LECTURE} />);
    expect(html).toMatch(/<p class="text-body [^"]*">/);
    expect(html).toContain('<span class="text-caption text-lantern-text-secondary mr-1.5">00:36');
    expect(html).toContain('Professor starts on entropy');
    expect(visibleText(html)).not.toContain('[00:36]');
  });

  it('keeps a single newline as a line break', () => {
    const html = render(<NoteReadingView body={'Line one\nLine two'} />);
    expect(html).toContain('<br/>');
  });

  it('shows the section heading a clear step above the body, with no hashes', () => {
    const html = render(<NoteReadingView body={LECTURE} />);
    // `##` is the 22 px serif title step, not the 17 px heading step it used
    // to be: 17 over a 15 body reads flat on a phone. See NoteReadingView.
    expect(html).toMatch(/<h2 class="text-title font-display font-semibold[^"]*">After class<\/h2>/);
    expect(visibleText(html)).not.toContain('#');
  });
});

/* ------------------------------------------------------------------ *
 * The tab row: a note shows exactly the surfaces it actually has.
 * ------------------------------------------------------------------ */

/**
 * `vi.mock` factories are hoisted above every import, so each one builds its
 * own selector-shaped stand-in rather than sharing a helper from this file —
 * a shared const is not initialised yet when the factory runs.
 */
function selectable(state: Record<string, unknown>) {
  const hook = (selector?: (s: Record<string, unknown>) => unknown) =>
    selector ? selector(state) : state;
  hook.getState = () => state;
  return hook;
}

vi.mock('../../stores/notesStore', () => ({
  useNotesStore: selectable({ saveNote: vi.fn(), createNote: vi.fn(), removeNote: vi.fn() }),
}));
vi.mock('../../stores/companionStore', () => ({
  useCompanionStore: selectable({ openWithMessage: vi.fn(), setActiveNoteContext: vi.fn() }),
}));
vi.mock('../../stores/toastStore', () => ({
  useToastStore: selectable({ showToast: vi.fn() }),
}));
vi.mock('../../stores/lectureRecordingStore', () => ({
  useLectureRecordingStore: selectable({
    status: 'idle',
    noteId: null,
    startedAt: null,
    pausedAt: null,
    pausedTotalMs: 0,
    tick: 0,
    committedTranscript: '',
    interimTranscript: '',
    whisperTranscript: '',
    start: vi.fn(),
    stopAndTranscribe: vi.fn(),
    pauseRecording: vi.fn(),
    resumeRecording: vi.fn(),
    discard: vi.fn(),
    cancelTranscription: vi.fn(),
    setCurrentBodyProvider: vi.fn(),
  }),
  getSessionElapsedMs: () => 0,
}));
// The audio tab's player talks to the API to re-sign its URL; the tab row is
// what this suite is about, so the network layer stays out of it.
vi.mock('../../services/notes', () => ({
  refreshNoteAttachmentUrl: vi.fn(async () => ({
    url: 'https://example.test/a.webm',
    expiresIn: 1,
  })),
}));

const TRANSCRIPT = 'Enzymes lower activation energy.';

const FULL_BODY = `[0:00] mine

Transcript

${TRANSCRIPT}

${SMART_NOTES_START}
${SMART_NOTES_HEADING}

- Enzymes cut the activation barrier.
${SMART_NOTES_END}
`;

const noteWith = (body: string, attachments: unknown[] = []) =>
  ({
    id: 'note-1',
    userId: 'u1',
    title: 'Lecture — 6 Sep',
    body,
    sourceType: 'audio',
    createdAt: '2026-09-06T00:00:00.000Z',
    updatedAt: '2026-09-06T00:00:00.000Z',
    attachments,
  }) as never;

const tabNames = (html: string) =>
  Array.from(html.matchAll(/role="tab"[^>]*>([^<]*)</g)).map((match) => match[1]);

describe('LectureStudio tab row', () => {
  const renderStudio = (note: unknown) =>
    render(
      <LectureStudio
        courseId="course-1"
        theme="light"
        note={note as never}
        lectures={note ? [note as never] : []}
        onTurnInto={() => undefined}
        onSmartNote={async () => undefined}
        onNoteReady={async () => undefined}
      />
    );

  it('shows all four tabs for a note that has all four sources', () => {
    const html = renderStudio(
      noteWith(FULL_BODY, [
        {
          id: 'att-1',
          type: 'audio',
          fileUrl: 'https://example.test/lecture.webm',
          fileName: 'lecture.webm',
          extractedText: TRANSCRIPT,
        },
      ])
    );
    expect(tabNames(html)).toEqual(['My Notes', 'Enhanced Notes', 'Transcript', 'Audio']);
    // Enhanced notes exist, so that is the tab the studio opens on.
    expect(html).toMatch(/aria-selected="true"[^>]*>Enhanced Notes</);
  });

  it('shows only My Notes for a bare note', () => {
    const html = renderStudio(noteWith('Just what I typed in class.'));
    expect(tabNames(html)).toEqual(['My Notes']);
    expect(html).toMatch(/aria-selected="true"[^>]*>My Notes</);
    // No transcript, no recording, no generated notes — so no tab claims one.
    // (Checked on the tab row, not the page: "Audio recap" is a Turn into target.)
    expect(tabNames(html)).not.toContain('Audio');
    expect(tabNames(html)).not.toContain('Transcript');
    expect(visibleText(html)).not.toContain('Enhanced Notes');
  });

  it('keeps the generated section out of the transcript tab', () => {
    const html = renderStudio(noteWith(FULL_BODY));
    expect(tabNames(html)).toEqual(['My Notes', 'Enhanced Notes', 'Transcript']);
    // The Enhanced panel is the open one and carries the generated bullet;
    // the sentinel comments never reach the screen.
    expect(visibleText(html)).toContain('Enzymes cut the activation barrier.');
    expect(html).not.toContain('lantern:smart-notes');
  });
});

/* ------------------------------------------------------------------ *
 * The enhance row: depth and price unchanged, two optional steers added.
 * ------------------------------------------------------------------ */

describe('LectureStudio enhance controls', () => {
  const renderStudio = (note: unknown, props: Record<string, unknown> = {}) =>
    render(
      <LectureStudio
        courseId="course-1"
        theme="light"
        note={note as never}
        lectures={note ? [note as never] : []}
        onTurnInto={() => undefined}
        onSmartNote={async () => undefined}
        onNoteReady={async () => undefined}
        {...props}
      />
    );

  it('offers a one-line skill hint with two example chips', () => {
    const html = renderStudio(noteWith(FULL_BODY));
    expect(html).toContain('id="lecture-skill-hint"');
    expect(visibleText(html)).toContain('How much do you already know?');
    expect(visibleText(html)).toContain('Basic');
    expect(visibleText(html)).toContain('Advanced');
  });

  it('caps the hint in the field itself, not only on the server', () => {
    expect(renderStudio(noteWith(FULL_BODY))).toContain('maxLength="200"');
  });

  it('keeps the depth row and its prices untouched', () => {
    const text = visibleText(renderStudio(noteWith(FULL_BODY)));
    expect(text).toContain('Summarized');
    expect(text).toContain('Enhance notes');
    // A hint is a sentence in the prompt, not a second call: the price line
    // is the same one the depth picker already showed.
    expect(text).toContain('1 AI use');
  });

  it('offers no material picker when the lecture is not in a study set', () => {
    // Without a set there is nothing to attach, and a "None"-only select is
    // a dead door.
    expect(renderStudio(noteWith(FULL_BODY))).not.toContain('id="lecture-context-note"');
  });
});
