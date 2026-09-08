/**
 * The two composition decisions the bottom chrome makes once the registry has
 * declared a row's mode (navigation/contextualBars.ts, founder decision
 * 2026-09-08): whether the global five-tab bar is on screen at all, and — when
 * it is not — whether the focused section's stack can go Back or is at its root.
 *
 * Pure and IMPORT-FREE on purpose, exactly like screenInsets.ts and
 * tabPressBehavior.ts next door: mobile jest runs on the `node` environment
 * with `testMatch: ['**\/*.test.ts']` and cannot transform a native module, so
 * every decision the bottom bar makes lives here and is exercised in
 * bottomBarComposition.test.ts. BottomTabBar.tsx and RootNavigator's
 * CustomTabBar are then a thin shell over these numbers.
 */

/**
 * The nested state of the focused tab's own stack, in the shape React
 * Navigation reports it on the parent tab navigator's `state.routes[i].state`.
 * A tab whose stack has not navigated yet has no nested state at all.
 */
export interface FocusedStackState {
  index?: number;
  routes?: readonly unknown[];
}

/**
 * Can the focused tab's stack pop — is there a screen behind the one on top?
 *
 * This is the sole input to the rules lane's `contextualExitControl`: true → the
 * replace-mode exit control is Back (pop the stack), false → it is Home (the
 * section root, with nothing behind it). One position, never inert.
 *
 * A stack entered by a nested navigate that dropped its own root
 * (planTabRootReset builds `[Library]`, index 0) reports false, so the exit is
 * Home — the honest answer, because there is genuinely nothing to pop back to
 * and a Back that did nothing is the one thing this control may never be. A tab
 * still showing its declared root (no nested state yet) reports false for the
 * same reason.
 */
export function canPopFocusedStack(childState: FocusedStackState | undefined | null): boolean {
  if (!childState || !Array.isArray(childState.routes) || childState.routes.length === 0) {
    return false;
  }
  const index =
    typeof childState.index === 'number' ? childState.index : childState.routes.length - 1;
  return index > 0;
}

export interface BottomBarComposition {
  /**
   * Render the global five-tab row. False in `replace` mode — the section's own
   * row stands in the bar's slot and the global five are not on screen.
   */
  showGlobalTabs: boolean;
  /**
   * Render the single leading exit control. True ONLY in `replace` mode: it is
   * the way out that makes taking the global bar away safe. An `above`-mode row
   * keeps the global bar (its own way out) and carries no exit control.
   */
  showExit: boolean;
}

/**
 * How the bottom bar composes for a route whose row does (`replace`) or does not
 * (`above`, or no row at all) take the global bar's slot.
 *
 * The standing rule this encodes — the one that must not ship a fifth dead
 * control: in replace mode the global five are NOT on screen and exactly one
 * leading exit control IS, so the way out is never lost; in every other case
 * the five are on screen and there is no exit control, byte-for-byte today's
 * shell.
 */
export function planBottomBarComposition({ replace }: { replace: boolean }): BottomBarComposition {
  return { showGlobalTabs: !replace, showExit: replace };
}
