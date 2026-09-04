/**
 * Pure arithmetic for the marketplace's keyboard-aware chrome.
 *
 * Imports nothing — not `react-native`, not a store — so jest's `node`
 * environment can run it (jest.config.js cannot transform a native module).
 * The components in this directory are then a thin shell over tested numbers,
 * which is the same split components/layout/screenInsets.ts uses.
 */

/**
 * Distance from the bottom of the window to the top of the keyboard.
 *
 * Computed from the keyboard's top edge in WINDOW coordinates rather than from
 * `endCoordinates.height`, which some Android versions report with the
 * navigation bar folded in and some without.
 */
export function keyboardBottomOffset(windowHeight: number, keyboardScreenY: number): number {
  if (!Number.isFinite(windowHeight) || !Number.isFinite(keyboardScreenY)) return 0;
  return Math.max(0, Math.round(windowHeight - keyboardScreenY));
}

export interface StickyBarPaddingInput {
  /** 0 while the keyboard is closed. */
  keyboardOffset: number;
  /** Clearance the bar owes at rest: tab bar, or the plain system inset. */
  restingClearance: number;
  /** Gap kept between the bar's last row and the keyboard. */
  keyboardExtra: number;
}

/**
 * Bottom padding for a bar pinned above the keyboard.
 *
 * With the keyboard up the bottom tab bar is BEHIND the keyboard, so paying
 * its ~102px clearance as well would strand the bar in a dead gap.
 */
export function stickyBarPaddingBottom({
  keyboardOffset,
  restingClearance,
  keyboardExtra,
}: StickyBarPaddingInput): number {
  const open = Number.isFinite(keyboardOffset) && keyboardOffset > 0;
  const value = open ? keyboardExtra : restingClearance;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export interface KeyboardSafeMaxHeightInput {
  windowHeight: number;
  /** 0 while the keyboard is closed. */
  keyboardOffset: number;
  /** The panel's own top edge, in window coordinates. */
  panelTopY: number;
  margin: number;
  minHeight: number;
}

/**
 * Height cap for a panel that must fit between its own top edge and the
 * keyboard, or `undefined` when no cap applies.
 *
 * `undefined` while the keyboard is closed is the point: the panel then lays
 * out at its natural height exactly as it did before, and only becomes a
 * bounded scroller for as long as the keyboard is covering it.
 */
export function keyboardSafeMaxHeight({
  windowHeight,
  keyboardOffset,
  panelTopY,
  margin,
  minHeight,
}: KeyboardSafeMaxHeightInput): number | undefined {
  if (!(keyboardOffset > 0) || !(panelTopY > 0)) return undefined;
  if (!Number.isFinite(windowHeight) || !Number.isFinite(margin)) return undefined;
  const available = windowHeight - keyboardOffset - panelTopY - margin;
  return Math.max(minHeight, Math.round(available));
}

export interface ScrollClearanceInput {
  /** Measured height of the pinned action bar, 0 when no bar is rendered. */
  actionBarHeight: number;
  /** Clearance the page owes with no bar over it. */
  baseClearance: number;
}

/**
 * Bottom padding for scroll content that a pinned action bar overlays.
 *
 * The bar is measured rather than guessed because its height is conditional —
 * ListingDetail's stacks a quantity stepper, a coupon row and two button rows,
 * reaching ~280px against the 140px literal the page used to reserve, so ~140px
 * of the listing could never be scrolled into view.
 */
export function scrollClearanceForActionBar({
  actionBarHeight,
  baseClearance,
}: ScrollClearanceInput): number {
  const bar = Number.isFinite(actionBarHeight) && actionBarHeight > 0 ? actionBarHeight : 0;
  const base = Number.isFinite(baseClearance) && baseClearance > 0 ? baseClearance : 0;
  return Math.max(bar, base);
}
