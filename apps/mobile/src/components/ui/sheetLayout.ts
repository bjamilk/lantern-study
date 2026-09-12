/**
 * How tall a bottom sheet, and the scroller inside it, are allowed to be.
 *
 * WHY THIS FILE EXISTS. `SheetShell` capped its body with
 * `maxHeight: '80%'`. A percentage resolves against the PARENT's definite
 * height, and the sheet card has none — it is bottom-anchored inside a
 * `justify-end` overlay and sized by its content. Yoga therefore drops the
 * constraint entirely, the ScrollView grows to its full content height, the
 * card grows past the top of the window, and the parts that overflow are
 * simply not drawn: on build 186's Import & Study the Flashcards/Quiz toggles
 * were clipped and "Import text" was off-screen, with no scroll to reach them
 * because the scroller believed it already fit. Same shape as the offline-box
 * saga — a container that cannot report a real height crushes what is in it.
 *
 * So the cap is computed in PIXELS here and handed to the component, and the
 * body is the one child allowed to shrink. The keyboard is part of the same
 * arithmetic rather than a second mechanism: the sheet lifts by the measured
 * overlap and loses exactly that much height, so the footer's primary action
 * is above the IME instead of being squeezed into a 14 px sliver.
 *
 * Deliberately imports nothing: mobile jest runs the `node` environment with
 * `testMatch: ['**\/*.test.ts']` and cannot transform a component, so numbers
 * a component computes are numbers nobody tests. Same reasoning as
 * bottomSheetKeyboard.ts and bottomBarComposition.ts next door.
 */

/**
 * Least sheet a keyboard lift may leave visible — the grabber, the heading and
 * one row. A keyboard tall enough to squeeze past this stops pushing.
 */
export const SHEET_MIN_VISIBLE_HEIGHT = 240;

/**
 * Least scrolling body, whatever the chrome around it measures. A body shorter
 * than this is not a sheet, it is a seam; the footer keeps its full height and
 * the sheet is allowed to run a little taller instead.
 */
export const SHEET_MIN_BODY_HEIGHT = 88;

export interface SheetLayoutInput {
  /** `useWindowDimensions().height`. */
  windowHeight: number;
  /** Window-bottom to keyboard-top, in px. 0 on every hide path. */
  keyboardHeight?: number;
  /** Safe-area top inset: the sheet must never rise under the status bar. */
  topInset?: number;
  /** Measured height of the grabber + heading row. */
  headerHeight?: number;
  /** Measured height of the pinned footer, including its bottom padding. */
  footerHeight?: number;
  /** How much of the room below the status bar a resting sheet may take. */
  maxHeightRatio?: number;
}

export interface SheetLayout {
  /** Definite px cap for the whole sheet card. Never a percentage. */
  maxSheetHeight: number;
  /** Definite px cap for the scrolling body between header and footer. */
  maxBodyHeight: number;
  /** Bottom margin that lifts the sheet clear of the keyboard. 0 at rest. */
  liftBy: number;
}

function finite(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

export function sheetLayout(input: SheetLayoutInput): SheetLayout {
  const windowHeight = finite(input.windowHeight);
  const topInset = finite(input.topInset);
  const keyboardHeight = finite(input.keyboardHeight);
  const headerHeight = finite(input.headerHeight);
  const footerHeight = finite(input.footerHeight);
  const ratio =
    typeof input.maxHeightRatio === 'number' &&
    Number.isFinite(input.maxHeightRatio) &&
    input.maxHeightRatio > 0
      ? Math.min(1, input.maxHeightRatio)
      : 0.8;

  // The band the sheet may occupy: everything below the status bar.
  const room = Math.max(0, Math.round(windowHeight - topInset));
  if (room <= 0) return { maxSheetHeight: 0, maxBodyHeight: 0, liftBy: 0 };

  // Lift by the whole keyboard, but never so far that the sheet has nowhere
  // left to be.
  const keepVisible = Math.min(room, SHEET_MIN_VISIBLE_HEIGHT);
  const liftBy = Math.min(Math.round(keyboardHeight), Math.max(0, room - keepVisible));

  // Two caps, and the tighter one wins: the resting share of the window, and
  // whatever the keyboard has left. `room - liftBy` is the guarantee that the
  // sheet's top edge can never cross `topInset`.
  const floor = Math.min(room, SHEET_MIN_VISIBLE_HEIGHT);
  const maxSheetHeight = Math.max(floor, Math.min(Math.round(room * ratio), room - liftBy));

  // The body is the only child that shrinks; header and footer keep theirs.
  const maxBodyHeight = Math.max(
    Math.min(maxSheetHeight, SHEET_MIN_BODY_HEIGHT),
    maxSheetHeight - headerHeight - footerHeight
  );

  return { maxSheetHeight, maxBodyHeight, liftBy };
}

export default sheetLayout;
