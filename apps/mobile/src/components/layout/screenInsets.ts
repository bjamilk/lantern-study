/**
 * Pure inset arithmetic for the screen layout primitives.
 *
 * Deliberately imports NOTHING — not `react-native`, not
 * `react-native-safe-area-context`, not a store. jest.config.js runs on the
 * `node` environment with `testMatch: ['**\/*.test.ts']` and cannot transform
 * a native module, so every number the primitives compute lives here and is
 * unit-tested in screenInsets.test.ts. The components are then a thin,
 * untestable shell over tested arithmetic.
 *
 * WHY THESE NUMBERS EXIST AT ALL
 * ------------------------------
 * Expo SDK 54 turns edge-to-edge on by default (android/gradle.properties
 * `edgeToEdgeEnabled=true`), so the app paints behind the status bar AND
 * behind the system navigation bar. Nothing is reserved for us; every pixel
 * of clearance is arithmetic somebody has to do. Before these helpers it was
 * done by hand, differently, in ~100 screens: `pb-8`, `paddingBottom: 24`,
 * `32`, `40`, `100`, `140`, `<View style={{height: 100}} />`. Every one of
 * those literals is wrong on at least one device.
 */

/**
 * The edges a screen container may own. `bottom` is deliberately absent: the
 * bottom is never a plain inset in this app, because the tab bar is an
 * ABSOLUTELY POSITIONED overlay (BottomTabBar.tsx) that covers content rather
 * than taking layout space. Screens that wrote `edges={['bottom']}` paid the
 * ~20-48px system inset and still lost their last row under an ~86-114px bar.
 * Bottom clearance goes through {@link resolveBottomClearance} instead.
 */
export type ScreenEdge = 'top' | 'left' | 'right';

export interface ScreenEdgeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ScreenEdgePadding {
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
}

/**
 * How a screen clears the bottom of the window.
 *
 * - `auto`   — tab-bar clearance when the bottom tab bar is on screen for this
 *              route, otherwise the plain system inset. The right default:
 *              the primitive knows which host it is in (ChromeContext) and the
 *              screen author does not have to.
 * - `tabBar` — force tab-bar clearance.
 * - `safe`   — system inset only (immersive routes, root-stack modals, sheets).
 * - `none`   — the screen pays its own bottom (e.g. it pins its own footer).
 */
export type BottomClearance = 'auto' | 'tabBar' | 'safe' | 'none';

/** Bar content height above the system inset — mirrors BottomTabBar's layout. */
export const TAB_BAR_CONTENT_HEIGHT = 56;

/**
 * Android gesture navigation frequently reports a bottom inset of 0 or a few
 * px. The bar itself pads by this floor, so clearance must use the same floor
 * or the two drift and content lands under the bar on exactly the devices
 * that report the smallest inset.
 */
export const TAB_BAR_BOTTOM_INSET_FLOOR = 20;

/** Breathing room between the last row and the bar, matching the bar's own gap. */
export const TAB_BAR_GAP = 10;

/** Floor for a plain bottom inset, so a 0-inset device still gets a margin. */
export const SAFE_BOTTOM_INSET_FLOOR = 12;

/** Default gap added on top of whichever clearance applies. */
export const DEFAULT_BOTTOM_EXTRA = 16;

/**
 * The padding above the pill row inside the bar (BottomTabBar's `pt-2`).
 *
 * Here so a test can assert that what the bar DRAWS — this padding plus the
 * pill's own height (theme/surfaceMetrics `TAB_PILL.height`) — still fits
 * inside {@link TAB_BAR_CONTENT_HEIGHT}, which is the number every screen's
 * clearance is computed from. The two are set in different files and nothing
 * but that assertion stops a taller pill from silently burying the last row of
 * every tab root.
 */
export const TAB_BAR_ROW_PADDING_TOP = 8;

/** Non-finite / negative inputs are treated as 0 rather than poisoning layout. */
function px(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * The bar's own bottom padding: the floored system inset plus the gap.
 *
 * BottomTabBar pays exactly this below the pill row, and {@link tabBarClearance}
 * pays it above the bar, so the two are one expression rather than two copies
 * of `Math.max(insets.bottom, 20) + 10`.
 */
export function bottomTabBarPadding(bottomInset: number): number {
  return Math.max(px(bottomInset), TAB_BAR_BOTTOM_INSET_FLOOR) + TAB_BAR_GAP;
}

/**
 * How tall the bottom tab bar actually is on this device, from its hairline to
 * the bottom of the window: content + floored inset + gap.
 *
 * This is the number a screen's bottom clearance must be at least as large as —
 * a clearance below it is a last row the student cannot tap. Exported so the
 * invariant can be asserted rather than assumed (screenInsets.test.ts).
 */
export function bottomTabBarHeight(bottomInset: number): number {
  return TAB_BAR_CONTENT_HEIGHT + bottomTabBarPadding(bottomInset);
}

/**
 * Bottom padding that clears the absolutely-positioned bottom tab bar.
 *
 * 56 + max(inset, 20) + 10 + extra, i.e. 102px at minimum and ~118px with
 * Android 3-button navigation. This is the exact expression `useTabBarClearance`
 * has always used; that hook now delegates here so the bar, the hook and the
 * primitives cannot drift apart.
 */
export function tabBarClearance(bottomInset: number, extra: number = DEFAULT_BOTTOM_EXTRA): number {
  return bottomTabBarHeight(bottomInset) + px(extra);
}

/**
 * Bottom padding for a screen with no tab bar over it: the system inset with a
 * floor, plus a gap. This is the pinned-footer idiom the study screens already
 * use (`Math.max(insets.bottom, 12) + 12`) generalised.
 */
export function safeBottomClearance(bottomInset: number, extra: number = DEFAULT_BOTTOM_EXTRA): number {
  return Math.max(px(bottomInset), SAFE_BOTTOM_INSET_FLOOR) + px(extra);
}

export interface BottomClearanceInput {
  mode: BottomClearance;
  bottomInset: number;
  /** Whether the bottom tab bar is currently drawn over this route. */
  tabBarPresent: boolean;
  extra?: number;
  /**
   * Height of the app-root cookie notice while it is still undismissed. It is
   * an `absolute bottom-0` overlay mounted OUTSIDE the navigator, so it covers
   * whatever the tab bar does not. 0 once a choice is recorded.
   */
  cookieNoticeInset?: number;
}

/** The single place a screen's bottom padding is decided. */
export function resolveBottomClearance({
  mode,
  bottomInset,
  tabBarPresent,
  extra = DEFAULT_BOTTOM_EXTRA,
  cookieNoticeInset = 0,
}: BottomClearanceInput): number {
  const cookie = px(cookieNoticeInset);
  if (mode === 'none') return cookie;
  const useTabBar = mode === 'tabBar' || (mode === 'auto' && tabBarPresent);
  const base = useTabBar ? tabBarClearance(bottomInset, extra) : safeBottomClearance(bottomInset, extra);
  return base + cookie;
}

/**
 * Padding for the edges a container owns. An edge left out of `edges` is
 * 0 here — that is how a screen sitting under a header that already pays
 * `insets.top` (ScreenHeader `safeTop`, or the in-flow TopBar) avoids being
 * padded twice.
 */
export function resolveEdgePadding(
  insets: ScreenEdgeInsets,
  edges: readonly ScreenEdge[]
): ScreenEdgePadding {
  return {
    paddingTop: edges.includes('top') ? px(insets.top) : 0,
    paddingRight: edges.includes('right') ? px(insets.right) : 0,
    paddingLeft: edges.includes('left') ? px(insets.left) : 0,
    paddingBottom: 0,
  };
}

/**
 * Restore insets that a detached window reports as 0.
 *
 * Nine routes are registered with `presentation: 'fullScreenModal'`. Such a
 * screen is its OWN native window, which the app-root SafeAreaProvider never
 * measures, so `useSafeAreaInsets()` and every `edges` prop inside it silently
 * return 0 — the screen looks correct in source and draws under the clock.
 * (Commit d31a28cf found this and fixed two of the nine by hand, by mounting a
 * second SafeAreaProvider inside the screen.)
 *
 * `initialWindowMetrics` is read synchronously from the native side at module
 * load for the REAL application window, so it still holds the true values in
 * that case. Falling back to it per-edge, only where the measured value is
 * exactly 0, repairs the detached window without touching any screen that
 * measures correctly.
 *
 * Safe here specifically because the app is portrait-locked (app.config.ts
 * `orientation: 'portrait'`): landscape is the one configuration where a top
 * inset legitimately collapses to 0 while the portrait metrics say 47-59.
 */
export function fallbackInsets(
  measured: ScreenEdgeInsets,
  initial: ScreenEdgeInsets | null | undefined
): ScreenEdgeInsets {
  if (!initial) return measured;
  const pick = (m: number, i: number): number => (px(m) === 0 ? px(i) : px(m));
  return {
    top: pick(measured.top, initial.top),
    right: pick(measured.right, initial.right),
    bottom: pick(measured.bottom, initial.bottom),
    left: pick(measured.left, initial.left),
  };
}

export interface RevealInputInput {
  /** Bottom edge of the focused input, in window coordinates. */
  inputBottomY: number;
  /** Top edge of the keyboard, in window coordinates (`endCoordinates.screenY`). */
  keyboardTopY: number;
  /** Breathing room to leave between the input and the keyboard. */
  margin?: number;
}

/**
 * How far to scroll DOWN so a focused input clears the keyboard. 0 when it is
 * already clear — never scroll a visible field away.
 *
 * Needed because a ScrollView alone does not solve this on the founder's
 * device: Android 15 (API 35+, and this app targets 36) stopped honouring
 * `adjustResize`, so the window is not resized when the keyboard opens and the
 * scroll viewport never shrinks. There is no extra scroll range to reach the
 * covered field with; the content has to be moved deliberately.
 */
export function scrollDeltaToRevealInput({
  inputBottomY,
  keyboardTopY,
  margin = 16,
}: RevealInputInput): number {
  if (!Number.isFinite(inputBottomY) || !Number.isFinite(keyboardTopY)) return 0;
  return Math.max(0, inputBottomY + px(margin) - keyboardTopY);
}
