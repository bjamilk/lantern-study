/**
 * What a press on the bottom bar means.
 *
 * The bar is a CUSTOM `tabBar`, so none of the stock bar's behaviour comes for
 * free — it only ever called `navigation.navigate(routeName)`. That is a
 * no-op on the tab you are already on, which is why pressing Study while deep
 * in Study → Tests did nothing, however many times you pressed it.
 *
 * The missing half is the `tabPress` EVENT. Every nested native-stack
 * navigator already subscribes to it (see @react-navigation/native-stack's
 * createNativeStackNavigator: on `tabPress`, if that stack is focused and not
 * at its root, it dispatches popToTop) and `useScrollToTop` listens for it
 * too. Nobody was emitting it. This plans the press; RootNavigator does the
 * emitting and dispatching, which cannot be unit-tested here (mobile jest is
 * node-env, `*.test.ts` only, and cannot transform a native module).
 *
 * Pure and import-free on purpose, like tabRouting.ts next door.
 */

/** The shape this needs from a navigation route — key and name, nothing else. */
export interface TabRouteLike {
  key: string;
  name: string;
}

export interface TabPressInput {
  /** `state.routes` from the tab navigator. */
  routes: readonly TabRouteLike[];
  /** `state.index` — which of them is focused. */
  index: number;
  /** The route the pressed tab points at, e.g. 'StudyTab'. */
  routeName: string;
}

export interface TabPressPlan {
  /**
   * Route key to emit `tabPress` on, or null when this navigator holds no
   * such route — there is then nothing to emit on, and the press degrades to
   * a plain navigate.
   *
   * Emitted for BOTH the active and an inactive tab, exactly as the stock bar
   * does: the nested listener checks focus itself, so an inactive tab's
   * remembered stack is never popped from under it.
   */
  emitTarget: string | null;
  /**
   * The route NAME to navigate to, or null when that tab is already focused —
   * navigating to it again is a no-op, and popping its stack is the event's
   * job, not the navigate's.
   *
   * A name, not a key: v7's TabRouter matches NAVIGATE by name and ignores a
   * key entirely. Switching tabs by name keeps the tab's remembered stack —
   * the router only moves the index.
   */
  navigateTo: string | null;
  /** The press landed on the tab that is already focused (a re-tap). */
  alreadyFocused: boolean;
  /**
   * This tab must open on its ROOT, whether or not it was already focused —
   * {@link ALWAYS_ROOT_ON_TAB_PRESS}.
   */
  resetToRoot: boolean;
}

/**
 * The tabs that always open on their root, even when the press arrives from
 * ANOTHER tab.
 *
 * SF2 §6 #10: after a walk through one set, tapping `Study` from Home landed
 * straight in a Lecture studio two levels deep — the tab's remembered stack —
 * with the sets list reachable only by Back. Remembered state is the right
 * default for Chat (the thread you were reading) and for Campus; it is the
 * wrong one for Study, whose root is the LIST of sets and whose children are
 * rooms you enter on purpose. A student pressing `Study` is asking "what am I
 * studying", not "put me back where I stopped".
 *
 * This does NOT touch Back: the reset happens on a tab PRESS only, so once the
 * student is inside a set, hardware Back keeps walking the stack it built.
 */
export const ALWAYS_ROOT_ON_TAB_PRESS: readonly string[] = ['StudyTab'];

export function planTabPress({ routes, index, routeName }: TabPressInput): TabPressPlan {
  const resetToRoot = ALWAYS_ROOT_ON_TAB_PRESS.includes(routeName);
  const target = routes.find(route => route.name === routeName);
  if (!target) {
    // Nothing to emit on, but still try the navigate: this is what the bar
    // did before the event existed, and the router ignores what it cannot
    // resolve.
    return { emitTarget: null, navigateTo: routeName, alreadyFocused: false, resetToRoot };
  }
  const focused = routes[index];
  const alreadyFocused = focused?.key === target.key;
  return {
    emitTarget: target.key,
    navigateTo: alreadyFocused ? null : target.name,
    alreadyFocused,
    resetToRoot,
  };
}

/**
 * The bottom of each tab's stack — the one screen a re-tap must land on.
 *
 * RootNavigator feeds these straight into each nested navigator's
 * `initialRouteName`, so the repair below and the navigators themselves can
 * never disagree about where "the root" is.
 */
export const TAB_STACK_ROOT_ROUTE = {
  HomeTab: 'Dashboard',
  StudyTab: 'StudyHub',
  ChatTab: 'GroupsList',
  CampusTab: 'Campus',
  MeTab: 'Me',
} as const;

/** The nested navigator state hanging off a tab route, as much as this needs. */
export interface NestedStackStateLike {
  /** Present once the child navigator has rehydrated; a dispatch needs it. */
  key?: string;
  index?: number;
  routes?: readonly { name: string }[];
}

export interface TabRootResetInput {
  /** `state.routes[state.index].state` for the tab that was re-tapped. */
  childState?: NestedStackStateLike | null;
  /** That tab's declared `initialRouteName` (see TAB_STACK_ROOT_ROUTE). */
  initialRouteName?: string;
  /**
   * Reset whenever the stack is not ALREADY sitting on its root alone, instead
   * of only when the root is missing from the bottom of the stack.
   *
   * For a re-tap of a properly rooted stack, native-stack's own `tabPress`
   * listener pops to top and this can stay out of the way. It cannot for a tab
   * pressed from ANOTHER tab: that listener only acts on the stack it is
   * focused in, so `Study` pressed from Home reopened its remembered child and
   * nothing popped it (SF2 §6 #10). {@link ALWAYS_ROOT_ON_TAB_PRESS} is what
   * sets this.
   */
  always?: boolean;
}

export interface TabRootResetPlan {
  /** Route to reset the nested stack onto, or null when popToTop is enough. */
  resetTo: string | null;
  /** The nested navigator's state key to aim the reset at. */
  target: string | null;
}

/**
 * The half `popToTop` cannot do: getting BACK TO THE ROOT when the root was
 * never on the stack.
 *
 * native-stack's own `tabPress` listener dispatches popToTop only when
 * `state.index > 0`, and popToTop resets to `routes[0]` — whatever that
 * happens to be. That is a correct root only when the stack was entered from
 * the top.
 *
 * It usually is not. A nested navigate — `navigate('StudyTab', { screen:
 * 'TestTaking' })` from Home, a group chat, the offline screen, a deep link —
 * initialises the child navigator from
 * `useNavigationBuilder`'s `getStateFromParams`, which builds
 * `{ routes: [{ name: params.screen }] }` and DROPS the initial route unless
 * the caller passed `initial: false`. The Study stack is then literally
 * `[TestTaking]` (or `[Library]`): index 0, so popToTop never fires, and the
 * screen's own `goBack()` is unhandled here and bubbles to the tab navigator,
 * which switches to Home. The Study root becomes unreachable.
 *
 * So: when the bottom of the stack is not the tab's initial route, a re-tap
 * has to RESET rather than pop. When it already is (Campus, and any stack
 * entered through its root), this returns null and the stock popToTop keeps
 * doing the job exactly as before.
 */
export function planTabRootReset({
  childState,
  initialRouteName,
  always = false,
}: TabRootResetInput): TabRootResetPlan {
  const nothing: TabRootResetPlan = { resetTo: null, target: null };

  if (!initialRouteName) return nothing;

  const routes = childState?.routes;
  // A lazy tab that has never been focused has no state at all. There is
  // nothing to repair: the plain navigate mounts it on its initial route.
  if (!routes || routes.length === 0) return nothing;

  // Without a key the state is still the partial one derived from params, and
  // a targeted dispatch has nowhere to land. The rehydrated state arrives a
  // render later and the next press repairs it.
  const target = childState?.key;
  if (!target) return nothing;

  // The root is already at the bottom — popToTop reaches it…
  if (routes[0]?.name === initialRouteName) {
    // …except when the press comes from another tab, where nothing will pop it:
    // reset unless the stack is already the root and only the root.
    if (always && routes.length > 1) return { resetTo: initialRouteName, target };
    return nothing;
  }

  return { resetTo: initialRouteName, target };
}
