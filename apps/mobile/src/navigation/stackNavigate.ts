/**
 * How the chrome reaches a screen INSIDE the tab stack that is already open.
 *
 * The contextual row (§7.2) navigates within the focused stack, never across
 * tabs. The chrome's own navigation object belongs to the TAB navigator, not
 * to the stack, so it aims a plain `navigate` at the child by `target` — the
 * key of the child navigator's state — which pushes onto the stack that is
 * already there, root intact.
 *
 * The hole this file closes: a nested navigator's state does not appear in its
 * parent until something inside it has navigated. On a freshly opened tab —
 * the Study hub, sitting at its own stack ROOT — `routes[index].state` is
 * `undefined`, there is no key to aim at, and the dispatch was skipped
 * entirely. Pressing Tests in the row did nothing at all on the hub, while the
 * same press from Library (a pushed screen, so the child state exists) worked.
 * Nothing warned; the row simply felt dead exactly where a student starts.
 *
 * So there are two ways to say the same thing, and this decides which one is
 * available:
 *
 *  - `dispatch` — the precise form, when the child's key is known.
 *  - `nested` — `navigate('<Tab>', toTab(route, params))`, which carries
 *    `initial: false` and therefore builds the stack as `[<tab root>, target]`
 *    rather than dropping the root (navigation/nestedTab.ts, and the lint that
 *    enforces it). Correct from the tab root, which is precisely the case that
 *    has no key.
 *
 * Pure and import-free apart from erased types plus `toTab`, which is itself
 * import-free — so mobile jest's node environment can hold all of it.
 */

import { toTab, type NestedTabTarget } from './nestedTab';

/** What the parent knows about a tab's child navigator: possibly nothing. */
export interface ChildStackStateLike {
  key?: string;
}

export interface StackNavigateInput {
  /** `state.routes[state.index]?.state` from the tab navigator. */
  childState: ChildStackStateLike | undefined | null;
  /** The tab route the focused stack belongs to, e.g. 'StudyTab'. */
  tabRouteName: string;
  /** A route NAME inside that stack. */
  route: string;
  /** That route's params, omitted entirely when there are none. */
  params?: Record<string, unknown>;
}

export type StackNavigatePlan =
  | {
      kind: 'dispatch';
      /** The child navigator's state key, to aim a plain navigate at. */
      target: string;
      route: string;
      params?: Record<string, unknown>;
    }
  | {
      kind: 'nested';
      /** The TAB to navigate to… */
      tabRouteName: string;
      /** …with these params, which always carry `initial: false`. */
      params: NestedTabTarget<Record<string, unknown>>;
    };

export function planStackNavigate({
  childState,
  tabRouteName,
  route,
  params,
}: StackNavigateInput): StackNavigatePlan {
  const target = typeof childState?.key === 'string' && childState.key ? childState.key : null;
  if (target) {
    return {
      kind: 'dispatch',
      target,
      route,
      ...(params !== undefined ? { params } : {}),
    };
  }
  return {
    kind: 'nested',
    tabRouteName,
    params: toTab<Record<string, unknown>>(route, params),
  };
}
