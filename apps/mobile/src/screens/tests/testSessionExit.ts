/**
 * How a test session screen gets OFF the stack it was pushed on.
 *
 * `navigation.goBack()` was never enough. Several entry points reach a
 * session by NESTED navigate — Home's "continue"/"start" cards, a group
 * chat's shared test, the offline screen, a deep link — and React Navigation
 * initialises the child navigator from `getStateFromParams`
 * (@react-navigation/core's useNavigationBuilder), which builds
 * `{ routes: [{ name: params.screen }] }`: the target becomes the stack's
 * ONLY route and the initial route is dropped, unless the caller passed
 * `initial: false`.
 *
 * On such a stack GO_BACK is unhandled here, bubbles to the TAB navigator and
 * merely switches tabs — so the session screen is never removed. It stays
 * mounted as the Study tab's root, and once the session is gone it renders
 * "This test session has ended." forever: `popToTop` cannot clear it (index
 * is already 0) and its own Go Back lands on Home.
 *
 * These planners answer "can this stack pop, or must it be reset onto the
 * Study root?" Pure and import-free so mobile jest (node env, `*.test.ts`)
 * can exercise them without a navigator.
 */

/** As much of a navigator's state as the planners need. */
export interface StackStateLike {
  index?: number;
  routes?: readonly { name: string }[];
}

/** Reset the stack onto these routes, bottom first. */
export interface ResetToRootPlan {
  action: 'resetToRoot';
  routes: readonly string[];
}

export type TestExitPlan =
  /** Something of this stack's own sits below — an ordinary pop is right. */
  | { action: 'pop' }
  /** This screen IS the bottom: reset the stack onto the tab's root. */
  | ResetToRootPlan;

export type TestsListExitPlan =
  | { action: 'popTo'; routeName: string }
  | ResetToRootPlan;

function focusedIndex(state?: StackStateLike | null): number {
  if (!state) return 0;
  if (typeof state.index === 'number') return state.index;
  return state.routes && state.routes.length > 0 ? state.routes.length - 1 : 0;
}

/**
 * Leaving a session screen (exit, end-of-study-session, or the dead-session
 * guard's Go Back).
 *
 * Popping is correct whenever this stack has a screen underneath — that is
 * the round-1/round-2 behaviour and it is left exactly as it was. Only the
 * bottom-of-stack case changes: instead of letting GO_BACK escape to the tab
 * navigator (which strands this screen and lands the reader on Home), the
 * stack is reset onto its root, which both removes the session screen and
 * puts the Study root back where a re-tap can reach it.
 */
export function planTestExit({
  state,
  rootRouteName,
}: {
  state?: StackStateLike | null;
  rootRouteName: string;
}): TestExitPlan {
  return focusedIndex(state) > 0
    ? { action: 'pop' }
    : { action: 'resetToRoot', routes: [rootRouteName] };
}

/**
 * The results screen's "Done" — leave the results behind, land on the tests
 * list, never stack a second copy of anything.
 *
 * `popTo` remains the answer whenever the stack is sound: it pops back to
 * TestsList when it is below, and otherwise REPLACES the results with it, so
 * the results screen is gone either way and whatever was under it survives.
 *
 * The one case it cannot serve is a stack whose bottom is the results screen
 * itself (arrived by nested navigate). `popTo` would then leave `[TestsList]`
 * — a tests list with nothing beneath it, whose own back button exits to
 * Home and which a re-tap of Study can never pop past. Rebuild the stack
 * instead, with the Study root underneath.
 */
export function planExitToTestsList({
  state,
  rootRouteName,
  testsListRouteName,
}: {
  state?: StackStateLike | null;
  rootRouteName: string;
  testsListRouteName: string;
}): TestsListExitPlan {
  const routes = state?.routes ?? [];
  const rooted = routes[0]?.name === rootRouteName;
  const hasTestsList = routes.some(route => route.name === testsListRouteName);

  if (rooted || hasTestsList) return { action: 'popTo', routeName: testsListRouteName };

  return { action: 'resetToRoot', routes: [rootRouteName, testsListRouteName] };
}
