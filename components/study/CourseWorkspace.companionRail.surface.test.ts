/**
 * The room's half of the companion rail, read out of the source.
 *
 * WHY NOT A MOUNT. `components/study/CourseWorkspace.tsx` imports the companion
 * panel, the walkthrough screen, the import modal and all eight studios; its
 * graph is most of the app, and mounting it needs ~20 module mocks that drift.
 * `CourseWorkspace.focus.surface.test.ts` gives the reason in full. The pieces
 * are tested properly elsewhere — `companionRail.test.ts` (the decision),
 * `useCompanionRail.test.tsx` (the measuring and the preference, in StrictMode),
 * `CompanionRailButton.render.test.tsx` (the rail and the overlay) — so what is
 * left for this file is the WIRING.
 *
 * It fails the way the regression would arrive: someone puts a viewport query
 * back, or drops the close control that makes a docked panel dismissible at all.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../..');
const ROOM = fs.readFileSync(path.join(REPO_ROOT, 'components/study/CourseWorkspace.tsx'), 'utf8');

/** Collapse whitespace so an assertion survives a reformat. */
const flat = (source: string) => source.replace(/\s+/g, ' ');

describe('the room measures itself instead of asking the window', () => {
  it('keeps no viewport query for the companion at all', () => {
    // The bug in issue #105, in one line: a media query answers "how wide is
    // the window", and the shell puts up to 608px of chrome in between.
    expect(ROOM).not.toContain("matchMedia('(min-width: 1024px)')");
  });

  it('asks the hook, on the surface it is currently on', () => {
    expect(flat(ROOM)).toContain("const rail = useCompanionRail(focusMode ? 'focus' : 'home');");
  });

  it('hands the hook the row the studio and the companion share', () => {
    expect(flat(ROOM)).toContain('<div ref={rail.rowRef}');
  });

  it('sizes the docked panel from the row, not from xl / 2xl', () => {
    expect(flat(ROOM)).toContain("{rail.mode === 'docked' ? (");
    expect(flat(ROOM)).toContain('${rail.dockWidthClass}');
    expect(ROOM).not.toContain('lg:w-96 xl:w-[28rem] 2xl:w-[32rem]');
  });
});

describe('there is exactly one chat control on screen', () => {
  it('draws the header buttons only where no rail is rendered', () => {
    // One of them now: the course room's ScreenHeader. The set room's Chat
    // button moved out of the set header and into `SetRoomTopBar` in the
    // 2026-09-17 parity pass, where it is a PROP rather than a child.
    expect(ROOM.match(/rail\.mode === 'none' \? \(/g)?.length).toBe(1);
    // Two prop forms: the focus bar's and the set room's top bar.
    expect(
      ROOM.match(/\{\.\.\.\(rail\.mode === 'none' \? \{ onOpenChat: \(\) => openSetChat\(\) \} : \{\}\)\}/g)
        ?.length
    ).toBe(2);
  });

  it('draws the collapsed rail when there is one', () => {
    expect(flat(ROOM)).toContain("{rail.mode === 'collapsed' ? ( <CompanionRailButton");
    expect(flat(ROOM)).toContain('onExpand={expandCompanionRail}');
  });
});

describe('a docked panel can be put away', () => {
  it('passes the close control the room never used to pass', () => {
    // `closable` has existed on AICompanionPanel since the Library note editor
    // needed it; the set room never passed it, so a wrong dock decision was not
    // recoverable by the student.
    expect(flat(ROOM)).toContain('closable onClose={collapseCompanionRail} closeLabel="Collapse Lantern AI"');
  });

  it('collapses rather than closes, and remembers it', () => {
    expect(flat(ROOM)).toContain(
      'const collapseCompanionRail = () => { rail.collapse(); useCompanionStore.getState().close(); };'
    );
  });

  it('leaves nothing open behind a rail that stopped being docked', () => {
    // Otherwise a window drag turns an open docked panel into a sheet thrown
    // over the studio: the overlay is the same store flag.
    expect(flat(ROOM)).toContain(
      "useEffect(() => { if (rail.mode !== 'docked') return; return () => { useCompanionStore.getState().close(); }; }, [rail.mode]);"
    );
  });
});

describe('a programmatic open is not the student’s choice of default', () => {
  it('expands without remembering, and moves focus into the composer', () => {
    expect(flat(ROOM)).toContain(
      'const openSetChat = (message?: string) => { rail.expand(); setCompanionFocusTick((tick) => tick + 1);'
    );
    // No `remember` here — that belongs to the rail button below, which IS the
    // student choosing.
    expect(flat(ROOM)).toContain(
      'const expandCompanionRail = () => { rail.expand({ remember: true });'
    );
  });

  it('is the only way anything in the room opens the companion', () => {
    // Every tile, header button and focus-bar control goes through it, so the
    // expand cannot be forgotten at one call site.
    const opens = ROOM.match(/useCompanionStore\.getState\(\)\.open(WithMessage)?\(/g) ?? [];
    expect(opens.length).toBe(3); // openSetChat's two branches + expandCompanionRail
  });
});
