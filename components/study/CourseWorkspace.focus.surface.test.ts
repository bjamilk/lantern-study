/**
 * The room's half of focus mode, read out of the source.
 *
 * WHY NOT A MOUNT. `components/study/CourseWorkspace.tsx` imports the
 * companion panel, the walkthrough screen, the import modal and all eight
 * studios; its graph is most of the app, and mounting it needs ~20 module
 * mocks. `components/ChatWindow.surface.test.ts` gives the reason in full: a
 * mock that drifts is how a surface test starts lying, and reading the text
 * cannot drift. The bar itself is mounted and asserted properly in
 * `SetRoomFocusBar.render.test.tsx`; the predicate has its own unit tests in
 * `packages/shared/src/learning/studySetRoutes.test.ts`. What is left for this
 * file is the WIRING — that the room asks the predicate, and that the three
 * pieces of chrome focus mode removes are actually gated on the answer.
 *
 * It fails the way a regression would arrive: someone drops the gate off the
 * tab bar, or draws the old header unconditionally again.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../..');
const ROOM = fs.readFileSync(path.join(REPO_ROOT, 'components/study/CourseWorkspace.tsx'), 'utf8');
const APP = fs.readFileSync(path.join(REPO_ROOT, 'App.tsx'), 'utf8');

/** Collapse whitespace so an assertion survives a reformat. */
const flat = (source: string) => source.replace(/\s+/g, ' ');

describe('the set room asks one predicate which state it is in', () => {
  it('derives focus from isSetRoomFocus and narrows it to a studio id', () => {
    expect(ROOM).toContain('isSetRoomFocus');
    expect(flat(ROOM)).toContain(
      'const focusMode = Boolean(studySetId) && isSetRoomFocus(activity, routePath);'
    );
    // `home` and `add` are excluded by the predicate; narrowing here is what
    // lets the bar take a WorkspaceActivityId without a cast.
    expect(flat(ROOM)).toContain(
      "focusMode && activity !== 'home' && activity !== 'add' ? activity : null"
    );
  });

  it('hands the same answer to the sidebar-collapse hook', () => {
    expect(flat(ROOM)).toContain('useFocusSidebarCollapse(focusMode);');
  });

  it('gates the room’s top bar on it, and picks the right one', () => {
    // Since the 2026-09-17 parity pass there are two: a set room gets
    // `SetRoomTopBar` (breadcrumb + Share + timer + kebab) and a course room
    // keeps the Study/Library tabs. Focus mode gets neither — the focus bar
    // (#104) is a studio's whole chrome.
    expect(flat(ROOM)).toContain('{focusActivity ? null : studySetId ? (');
    expect(flat(ROOM)).toContain(') : ( <StudyWorkspaceBar');
    expect(ROOM.match(/<SetRoomTopBar/g)?.length).toBe(1);
    // Two: this one, and the loading / set-unavailable early return above it.
    expect(ROOM.match(/<StudyWorkspaceBar/g)?.length).toBe(2);
  });

  it('draws the focus bar instead of the old header, never both', () => {
    expect(flat(ROOM)).toContain('{focusActivity && studySetId ? (');
    expect(flat(ROOM)).toContain('<SetRoomFocusBar');
    // The old header is still the HOME chrome, in the same ternary's else.
    expect(flat(ROOM)).toContain(') : studySetId ? (');
    expect(ROOM.match(/<SetRoomFocusBar/g)?.length).toBe(1);
    expect(ROOM.match(/<SetRoomHeader/g)?.length).toBe(1);
  });

  it('gives the studio the top padding back in focus', () => {
    expect(flat(ROOM)).toContain("focusActivity ? 'pt-0' : 'pt-4'");
  });

  it('leaves the course room alone: no studySetId, no focus', () => {
    // `Boolean(studySetId) &&` is the whole guard. A course room keeps its
    // activity chip strip and its Materials column.
    expect(flat(ROOM)).toContain('Boolean(studySetId) && isSetRoomFocus');
  });
});

describe('the app shell hides its breadcrumb strip in focus', () => {
  it('uses the same predicate, off the same parsed URL', () => {
    expect(APP).toContain('isSetRoomFocusPath');
    expect(flat(APP)).toContain('|| isSetRoomFocusPath(studySetPath)');
  });
});

describe('the app shell owns the restore the room cannot do', () => {
  const SHELL = fs.readFileSync(path.join(REPO_ROOT, 'components/layout/AppShell.tsx'), 'utf8');

  it('asks the same question off the URL and calls the restore hook', () => {
    // A reload inside a studio never runs the room's cleanup, and on the next
    // visit the student may land where the room never mounts — so the shell,
    // which mounts on every route, is the only thing that can notice.
    expect(flat(SHELL)).toContain(
      'useFocusStandDownRestore(isSetRoomFocusPath(parseStudySetPath(location.pathname)));'
    );
  });
});
