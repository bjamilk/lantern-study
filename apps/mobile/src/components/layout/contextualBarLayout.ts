/**
 * The arithmetic and the two yes/no decisions behind the contextual row.
 *
 * Spec v3 §7.2. The row is a 44 dp segment strip drawn directly ABOVE the
 * global bottom bar, inside the same absolutely-positioned chrome view. Its
 * items are a property of the FOCUSED ROUTE — exactly as `immersive` already
 * is — never of scrolling, the keyboard or a selection.
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
}: ContextualPresenceInput<Spec>): Spec | null {
  if (!withinChrome) return null;
  if (immersive) return null;
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
  /** Whatever the tab-bar clearance already came to (screenInsets.ts). */
  base: number;
  /** The row's content height, e.g. CONTEXTUAL_BAR_CONTENT_HEIGHT. */
  contentHeight: number;
  /** Whether the row is on screen for this route. */
  present: boolean;
}

/**
 * Bottom padding that clears BOTH bars.
 *
 * The offline-box saga is the warning here: a list whose last row hides under
 * the chrome is not a small cosmetic miss, it is a row the student cannot
 * reach. Clearance is additive and unconditional — the row's height, or zero —
 * so no screen has to know whether its route has a registry entry.
 */
export function contextualBarClearance({
  base,
  contentHeight,
  present,
}: ContextualClearanceInput): number {
  return px(base) + contextualBarHeight(present, contentHeight);
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
