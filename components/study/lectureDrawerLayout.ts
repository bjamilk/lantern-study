/**
 * Where the transcript drawer goes: beside the editor, or over it.
 *
 * WHY THIS IS A FUNCTION AND NOT A BREAKPOINT. The drawer is the THIRD column
 * of a set room that already decides its second one by measurement
 * (`companionRail.ts`, issue #105): the room's width is not the window's width,
 * because the shell puts up to 608px of chrome to its left and the companion
 * takes 384–512 more on its right. A media query would open a 236px drawer into
 * a studio that has 300px left — which is the failure `companionRail` exists to
 * have stopped making.
 *
 * So the studio measures ITSELF (the element the editor and the drawer share)
 * and asks this file what fits. The rule is the same shape as the companion's:
 * the thing being studied comes first. Below `LECTURE_EDITOR_MIN` of editor,
 * the drawer stops being a column and becomes a sheet over the studio — the
 * student can still read the transcript, and the notes they are typing into
 * keep a line worth reading.
 *
 * The numbers are measured off the reference at 1440 (doc 04 §9): a 236px
 * drawer with a 16px gutter beside it.
 */

/** The drawer's own width. Measured; do not round it to a Tailwind step. */
export const LECTURE_DRAWER_WIDTH = 236;

/** The gap between the editor column and the drawer. */
export const LECTURE_DRAWER_GAP = 16;

/**
 * The narrowest editor the drawer is allowed to leave behind.
 *
 * 480 is where a note line stops holding ~70 characters at the body step, which
 * is the width at which typing in class stops being the point of the pane. It
 * is deliberately ABOVE `COMPANION_RAIL_STUDIO_MIN` (540 minus the drawer's
 * 252 would be 288): the companion's floor protects a quiz question, this one
 * protects a writing surface.
 */
export const LECTURE_EDITOR_MIN = 480;

/** What the studio draws for the drawer. */
export type LectureDrawerPlacement = 'inline' | 'sheet';

/**
 * Inline while the editor keeps its minimum; a sheet below that.
 *
 * `studioWidth` is the measured width of the studio's own row — everything the
 * lecture surface has after the sidebar, the chats flyout and the companion
 * rail have taken theirs.
 */
export function lectureDrawerPlacement(studioWidth: number): LectureDrawerPlacement {
  if (!Number.isFinite(studioWidth) || studioWidth <= 0) return 'inline';
  return studioWidth - (LECTURE_DRAWER_WIDTH + LECTURE_DRAWER_GAP) >= LECTURE_EDITOR_MIN
    ? 'inline'
    : 'sheet';
}

/**
 * The editor's content width at a given studio width, with the drawer's column
 * removed when it is inline.
 *
 * Exported for the tests that assert the three measured windows (1440 / 1280 /
 * 1024) rather than for the render, which uses flex.
 */
export function lectureEditorWidth(
  studioWidth: number,
  drawerOpen: boolean
): number {
  if (!drawerOpen || lectureDrawerPlacement(studioWidth) === 'sheet') return studioWidth;
  return studioWidth - (LECTURE_DRAWER_WIDTH + LECTURE_DRAWER_GAP);
}
