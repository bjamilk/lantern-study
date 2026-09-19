import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  SMART_NOTES_END,
  SMART_NOTES_HEADING,
  SMART_NOTES_START,
} from '@lantern/shared/utils/smartNotes';
import { LectureStudio } from './LectureStudio';
import { NoteReadingView } from './NoteReadingView';
import {
  LECTURE_DRAWER_WIDTH,
  LECTURE_EDITOR_MIN,
  lectureDrawerPlacement,
  lectureEditorWidth,
} from './lectureDrawerLayout';

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
    expect(html).toMatch(/<h2 class="text-title font-display font-semibold[^"]*">After class<\/h2>/);
    expect(visibleText(html)).not.toContain('#');
  });
});

/* ------------------------------------------------------------------ *
 * The three columns: where the drawer goes at the measured widths.
 * ------------------------------------------------------------------ */

describe('transcript drawer placement', () => {
  /**
   * The numbers are the STUDIO's width, not the window's: a 1440 window in a
   * set room is ~1216 after the 224px sidebar, and less again once the
   * companion docks. See `companionRail.ts` for that arithmetic — this file
   * only decides what is left after it.
   */
  it('keeps the drawer inline at 1440, 1280 and 1024 in focus mode', () => {
    // A studio is FOCUS, where the companion defaults to its 48px rail
    // (`COMPANION_RAIL_DEFAULTS.focus`). 1440 − 224 sidebar − 48 rail = 1168.
    expect(lectureDrawerPlacement(1168)).toBe('inline');
    expect(lectureEditorWidth(1168, true)).toBe(1168 - LECTURE_DRAWER_WIDTH - 16);
    // 1280 − 224 − 48 = 1008; 1024 − 224 − 48 = 752. Both still write-able.
    expect(lectureDrawerPlacement(1008)).toBe('inline');
    expect(lectureDrawerPlacement(752)).toBe('inline');
  });

  it('keeps it inline at 1440 with the companion docked, and overlays below that', () => {
    // 1440 − 224 − 400 docked companion = 816: three columns still fit.
    expect(lectureDrawerPlacement(816)).toBe('inline');
    // 1280 − 224 − 400 = 656, which would leave a 404px editor. The drawer
    // becomes a sheet instead: the notes keep a line you can write in.
    expect(lectureDrawerPlacement(656)).toBe('sheet');
    // 1024 with a docked companion is 400 of studio — below the floor before
    // the drawer is even considered, and the editor keeps all of it.
    expect(lectureDrawerPlacement(400)).toBe('sheet');
    expect(lectureEditorWidth(400, true)).toBe(400);
  });

  it('draws the line exactly at the editor minimum', () => {
    const exact = LECTURE_EDITOR_MIN + LECTURE_DRAWER_WIDTH + 16;
    expect(lectureDrawerPlacement(exact)).toBe('inline');
    expect(lectureDrawerPlacement(exact - 1)).toBe('sheet');
  });
});

/* ------------------------------------------------------------------ *
 * The floating tab pill, and the surfaces behind it.
 * ------------------------------------------------------------------ */

/**
 * `vi.mock` factories are hoisted above every import, so each one builds its
 * own selector-shaped stand-in rather than sharing a helper from this file.
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
    segments: [],
    transcriptNoteId: null,
    start: vi.fn(),
    stopAndTranscribe: vi.fn(),
    pauseRecording: vi.fn(),
    resumeRecording: vi.fn(),
    discard: vi.fn(),
    cancelTranscription: vi.fn(),
    retrySegment: vi.fn(),
    hydrateFromNote: vi.fn(),
    setCurrentBodyProvider: vi.fn(),
  }),
  getSessionElapsedMs: () => 0,
}));
// The audio tab's player talks to the API to re-sign its URL; the layout is
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

describe('LectureStudio tab pill', () => {
  it('always shows the five tabs, in the reference order', () => {
    expect(tabNames(renderStudio(noteWith(FULL_BODY)))).toEqual([
      'My Notes',
      'Enhanced Notes',
      'Material',
      'Audio Files',
      '🎙 Record',
    ]);
  });

  it('greys Enhanced Notes, with its reason, until a lecture has any', () => {
    const html = renderStudio(noteWith('Just what I typed in class.'));
    expect(html).toMatch(/aria-disabled="true"[^>]*>Enhanced Notes</);
    expect(html).toContain('Enhance this lecture to fill this tab.');
  });

  it('is a real tablist with roving focus, which the reference has none of', () => {
    const html = renderStudio(noteWith(FULL_BODY));
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-orientation="horizontal"');
    // The selected tab is the only one in the tab order.
    expect(html).toMatch(/aria-selected="true"[^>]*tabindex="0"/);
  });

  it('opens on My Notes and keeps the generated section off it', () => {
    const html = renderStudio(noteWith(FULL_BODY));
    expect(html).toMatch(/aria-selected="true"[^>]*>My Notes</);
    expect(visibleText(html)).not.toContain('Enzymes cut the activation barrier.');
    expect(html).not.toContain('lantern:smart-notes');
  });
});

describe('LectureStudio header and drawer', () => {
  it('carries the lecture title, Turn into and Share — not a row of pills', () => {
    const html = renderStudio(noteWith(FULL_BODY));
    expect(html).toContain('aria-label="Lecture title"');
    expect(visibleText(html)).toContain('Turn into');
    expect(visibleText(html)).toContain('Share');
  });

  it('opens with the drawer closed on a finished lecture', () => {
    const html = renderStudio(noteWith(FULL_BODY));
    expect(html).not.toContain('data-testid="lecture-drawer-inline"');
    expect(html).toContain('data-drawer-placement=');
  });
});
