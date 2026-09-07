/**
 * Where a bottom sheet sits while the keyboard is up — and, more importantly,
 * where it goes back to when the keyboard leaves.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * These sheets used to hand the job to `KeyboardAvoidingView` with
 * `behavior="padding"`. On Android that never gives the space back.
 * React Native subscribes BOTH `keyboardDidShow` and `keyboardDidHide` to the
 * same handler (`_onKeyboardChange`), which stores the event and re-derives the
 * padding from `endCoordinates.screenY`; only iOS gets the `_onKeyboardHide`
 * handler that clears the stored event. So on a hide, the padding is not reset
 * to zero — it is RECOMPUTED from the hide event's own frame. Inside a
 * transparent `statusBarTranslucent` Modal under edge-to-edge that frame is the
 * window minus the gesture bar, so ~200px of padding is left behind forever.
 *
 * On build 171 that stranded the generate sheet: a 92%-tall sheet with ~200px
 * of padding under it has its top edge at y≈0, so the header and its close X
 * were drawn beneath the system status bar, where the tap never reached them.
 * The chips lower down still worked, so the sheet was open with no way out.
 *
 * The rule here replaces that with two numbers a component cannot get wrong:
 * how far to lift the sheet off the bottom, and how tall it may be. Both are
 * derived from a measured keyboard overlap that is set to 0 on EVERY hide path
 * (back button, tap-away, the done key), so resting position is the state the
 * sheet returns to by construction rather than by hoping for an event.
 *
 * The invariant the device evidence asks for: the sheet's top edge never rises
 * above the top safe-area inset, so the header — and the close control in it —
 * is always on screen and always tappable.
 *
 * Deliberately imports nothing: jest.config.js runs the `node` environment with
 * `testMatch: ['**\/*.test.ts']` and cannot transform a component, so numbers a
 * component computes are numbers nobody tests.
 */

/**
 * Least sheet a lift may leave visible.
 *
 * Enough for the header row and one field. A keyboard tall enough to squeeze
 * past this stops pushing: better a sheet the keyboard overlaps a little than a
 * sheet with nothing on screen but its rounded corners.
 */
export const BOTTOM_SHEET_MIN_VISIBLE_HEIGHT = 240;

export interface BottomSheetKeyboardInput {
  /** `useWindowDimensions().height`. */
  windowHeight: number;
  /** The height the sheet wants when nothing is covering it. */
  restingHeight: number;
  /**
   * Distance from the bottom of the window to the top of the keyboard, in px.
   * 0 whenever the keyboard is closed — on every hide path.
   */
  keyboardOverlap: number;
  /** Safe-area top inset: under edge-to-edge the sheet paints behind it. */
  topInset?: number;
}

export interface BottomSheetKeyboardLayout {
  /** Definite height for the sheet wrapper. Never a percentage. */
  height: number;
  /** Bottom padding on the sheet's bottom-anchored overlay. 0 at rest. */
  liftBy: number;
}

function finite(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Lift a bottom-anchored sheet clear of the keyboard, shrinking it to fit
 * rather than pushing its header off the top of the screen.
 *
 * With `keyboardOverlap` at 0 this returns the sheet's resting geometry
 * unchanged — that is what makes every hide path restore the sheet.
 */
export function planBottomSheetKeyboard(
  input: BottomSheetKeyboardInput
): BottomSheetKeyboardLayout {
  const windowHeight = finite(input.windowHeight);
  const topInset = finite(input.topInset);
  const restingHeight = finite(input.restingHeight);
  const overlap = finite(input.keyboardOverlap);

  // The band the sheet is allowed to occupy: everything below the status bar.
  const room = Math.max(0, Math.round(windowHeight - topInset));
  if (room <= 0) return { height: 0, liftBy: 0 };

  // Never lift so far that the sheet has nowhere left to be.
  const keepVisible = Math.min(restingHeight, BOTTOM_SHEET_MIN_VISIBLE_HEIGHT);
  const maxLift = Math.max(0, room - keepVisible);
  const liftBy = Math.min(Math.round(overlap), maxLift);

  // height <= room - liftBy is the whole guarantee: the sheet's top edge,
  // windowHeight - liftBy - height, can then never be above topInset.
  const height = Math.max(0, Math.min(restingHeight, room - liftBy));

  return { height, liftBy };
}

/**
 * The sheet's top edge in window coordinates, for tests and for anyone
 * reasoning about whether the header is reachable.
 */
export function bottomSheetTopEdge(
  windowHeight: number,
  layout: BottomSheetKeyboardLayout
): number {
  return finite(windowHeight) - layout.liftBy - layout.height;
}
