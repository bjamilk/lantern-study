/**
 * The arithmetic and the two yes/no decisions behind the contextual row.
 *
 * Spec v3 §7.2, as amended by the founder (2026-09-08). The row is a 44 dp
 * segment strip inside the absolutely-positioned chrome view. Where it sits
 * depends on the registry's mode (navigation/contextualBars.ts):
 *
 * - `above` — drawn directly ABOVE the global bottom bar, today's behaviour.
 *   Its clearance is the bar's clearance PLUS the row.
 * - `replace` — drawn IN the global bar's slot; the global bar is not on screen
 *   in that section. Its clearance is the bar's clearance with the bar's own
 *   content height taken back OUT and the row put in its place, so a screen
 *   pads for one strip and not two.
 *
 * The mode is a boolean input here — `replaceMode` on the clearance call — not
 * an import: this file cannot import the registry (see below), so the chrome
 * passes {@link replacesGlobalBar}(spec) in the way it already passes `present`.
 *
 * The row's items are a property of the FOCUSED ROUTE — exactly as `immersive`
 * already is — never of scrolling, the keyboard or a selection.
 *
 * Everything a test can hold is here: whether the row is on screen at all,
 * what it adds to a screen's bottom clearance, and whether the swap animates.
 * The component itself (ContextualBar.tsx) is then a thin, untestable shell
 * over tested numbers, the same bargain screenInsets.ts already makes.
 *
 * Pure and IMPORT-FREE on purpose — not `react-native`, not the theme, not
 * navigation/contextualBars.ts. mobile jest runs on the `node` environment
 * with `testMatch: ['**\/*.test.ts']` and cannot transform a native module;
 * the row height therefore arrives as an argument rather than an import, so
 * this file can be exercised on its own.
 */

/**
 * Height + opacity, 150 ms, on a registry change. The number the spec names.
 * The GLOBAL bar never animates — only this row does, and only when its
 * registry entry changes.
 */
export const CONTEXTUAL_BAR_ANIMATION_MS = 150;

/**
 * The row's content height, 44 dp — Material's minimum target, and the number
 * §7.2 names. It lives HERE and not in ContextualBar.tsx because
 * `useTabBarClearance` needs it and BottomTabBar.tsx is imported by ~40
 * screens: importing the component for a constant would drag the companion,
 * notes and toast stores into every one of their module graphs, which is the
 * exact cycle risk components/layout/index.ts keeps TopBar out of the barrel
 * for.
 */
export const CONTEXTUAL_BAR_CONTENT_HEIGHT = 44;

/** Non-finite / negative inputs are treated as 0 rather than poisoning layout. */
function px(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export interface ContextualPresenceInput<Spec> {
  /** What the registry returns for the focused route, or null for "no row". */
  spec: Spec | null | undefined;
  /**
   * True on a route that owns the whole window. Both bars unmount there, so
   * the row must too — the screen's own header back is the one tap out.
   */
  immersive: boolean;
  /**
   * False outside MainTabs (the auth stack, a root-stack modal). Those hosts
   * have no bottom bar at all, so there is nothing for a row to sit above.
   */
  withinChrome: boolean;
  /**
   * True while the soft keyboard is up.
   *
   * The one thing that hides the row without being a property of the route,
   * and it is here rather than in the component because it is a DECISION, not
   * an animation. On Android the IME is drawn over the bottom of the window:
   * build 166's note editor showed the row buried under the keyboard, present
   * in the tree, unreachable by a thumb (`21-kbd-up.png`). The choice is to
   * hide it or to lift it, and lifting loses either way — a row that rides the
   * IME covers the text the student is typing, and a row you cannot press is
   * worse than a row that is not there. So: while the keyboard is up there is
   * no row, and it comes straight back when the keyboard goes down.
   *
   * This does NOT re-open the "bars move on scroll" door the chrome closed: a
   * keyboard is an explicit act by the student on this screen, not a side
   * effect of reading, and the GLOBAL bar still never moves.
   *
   * Optional, and false when omitted, so a host with no keyboard to speak of
   * (and every existing caller) keeps today's behaviour.
   */
  keyboardVisible?: boolean;
}

/**
 * The spec that is actually on screen, or null.
 *
 * Generic in the spec type so this file need not import lane A's registry:
 * the caller passes `specForRoute(focusedRoute)` in and gets it back or null.
 * The point of the function is the two suppressions, which are easy to forget
 * at a call site and impossible to see in a screenshot until a study session
 * draws a stray strip over its own footer.
 */
export function resolveContextualSpec<Spec>({
  spec,
  immersive,
  withinChrome,
  keyboardVisible = false,
}: ContextualPresenceInput<Spec>): Spec | null {
  if (!withinChrome) return null;
  if (immersive) return null;
  if (keyboardVisible) return null;
  return spec ?? null;
}

/**
 * How tall the row is right now: its content height when present, 0 when not.
 *
 * 0 rather than "unmounted" is the honest answer for the clearance callers —
 * a screen adds this to its bottom padding unconditionally and gets today's
 * shell back when the registry has no entry for the route.
 */
export function contextualBarHeight(present: boolean, contentHeight: number): number {
  return present ? px(contentHeight) : 0;
}

export interface ContextualClearanceInput {
  /**
   * The tab-bar clearance the screen would use with the GLOBAL bar present
   * (screenInsets.tabBarClearance) — i.e. the global bar's content height plus
   * the floored safe-area inset and gap. Both modes start from this so the
   * safe-area handling is computed in exactly one place.
   */
  base: number;
  /** The row's content height, e.g. CONTEXTUAL_BAR_CONTENT_HEIGHT. */
  contentHeight: number;
  /** Whether the row is on screen for this route. */
  present: boolean;
  /**
   * True when this row REPLACES the global bar (Study, Shop). The global bar is
   * then NOT on screen, so its own content height is taken back out of `base`
   * and the row stands in its place: the total is safe-area + row, not
   * safe-area + bar + row. Defaults false, which is today's `above` behaviour,
   * so every existing caller is unchanged until it opts in.
   */
  replaceMode?: boolean;
  /**
   * The global bar's own content height (screenInsets.TAB_BAR_CONTENT_HEIGHT,
   * 56). ONLY read in replace mode, to remove the bar that is no longer drawn.
   * An input rather than an import so this file stays node-testable in
   * isolation. Defaults 0, which makes replace mode a no-op if a caller forgets
   * it — the safe direction, since the result then only ever over-clears.
   */
  globalBarContentHeight?: number;
}

/**
 * Bottom padding that clears whatever chrome sits at the bottom of THIS route.
 *
 * The offline-box saga is the warning here: a list whose last row hides under
 * the chrome is not a small cosmetic miss, it is a row the student cannot
 * reach. So the arithmetic errs toward clearing too much, never too little.
 *
 * - No row (`present` false): the global bar's own clearance, `base`. This is
 *   every route outside a registry, and the immersive case where the row is
 *   hidden entirely — nothing stands in the bar's place, so there is nothing to
 *   add or subtract.
 * - `above` mode: `base` PLUS the row, the two bars stacked.
 * - `replace` mode: `base` PLUS the row MINUS the global bar's content height,
 *   because the bar is gone and the row occupies its slot. Floored at the row
 *   itself so a degenerate `base` can never return less than the strip a screen
 *   must clear.
 */
export function contextualBarClearance({
  base,
  contentHeight,
  present,
  replaceMode = false,
  globalBarContentHeight = 0,
}: ContextualClearanceInput): number {
  const row = contextualBarHeight(present, contentHeight);
  if (!present) return px(base);
  if (!replaceMode) return px(base) + row;
  return Math.max(row, px(base) + row - px(globalBarContentHeight));
}

/**
 * The duration for the height+opacity swap: 150 ms normally, 0 under the
 * accessibility setting.
 *
 * 0 rather than a flag the caller may forget to check: `Animated.timing` with
 * duration 0 lands on the next frame with no interpolation, so one number
 * expresses both cases and there is no branch to get wrong.
 */
export function contextualBarTransitionMs(reduceMotion: boolean): number {
  return reduceMotion ? 0 : CONTEXTUAL_BAR_ANIMATION_MS;
}

/** Whether the swap animates at all. The readable half of the number above. */
export function shouldAnimateContextualBar(reduceMotion: boolean): boolean {
  return contextualBarTransitionMs(reduceMotion) > 0;
}
