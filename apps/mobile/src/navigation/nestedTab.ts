/**
 * The one safe way to name a screen inside another tab's stack.
 *
 * `navigate('StudyTab', { screen: 'TestTaking', params })` does NOT push
 * TestTaking onto the Study stack. When that child navigator has not mounted
 * yet, React Navigation builds its state from the params
 * (@react-navigation/core useNavigationBuilder → getStateFromParams), which
 * produces `{ routes: [{ name: 'TestTaking' }] }` — the target screen is the
 * stack's ONLY route and the tab's own root is never put beneath it. The
 * result is a dead end: `goBack()` is unhandled by that stack and escapes to
 * the tab navigator (landing on Home), `popToTop` cannot pop an index of 0,
 * and re-tapping the tab can never reach its root. `initial: false` makes the
 * stack `[<tab root>, <target>]` instead, which is what every one of these
 * call sites actually means.
 *
 * It is one word, it is invisible when missing, and it was missing at roughly
 * thirty-five call sites. So it stops being something a caller remembers:
 * `toTab` is the only shape allowed, and navigation/nestedNavigateLint.test.ts
 * fails the suite if a raw nested navigate reappears without it.
 *
 * To land on a tab's ROOT, navigate to the tab alone —
 * `navigate('HomeTab')` — rather than naming the root screen here; naming it
 * with `initial: false` would stack the root under itself.
 *
 * Pure and import-free (a type only), so jest's node environment can test it.
 */

/**
 * What a nested navigate delivers as the tab screen's params.
 *
 * A type alias rather than an interface on purpose: most of these call sites
 * hand the result to a loosely typed `navigate(screen, params?:
 * Record<string, unknown>)`, and TypeScript grants an implicit index
 * signature to object type ALIASES but never to interfaces. As an interface
 * this would fail to type-check at a dozen screens.
 */
export type NestedTabTarget<P> = {
  /** The child route to open. */
  screen: string;
  /** That route's params, omitted entirely when there are none. */
  params?: P;
  /** Always false — see the note above; this is the whole point of the file. */
  initial: false;
};

/**
 * Build the params for `navigate('<SomeTab>', toTab(screen, params))`.
 *
 * @param screen The route name inside the target tab's stack.
 * @param params That route's params. Omitted from the result when undefined,
 *   so the screen keeps whatever defaults it declares.
 */
export function toTab<P extends object>(screen: string, params?: P): NestedTabTarget<P> {
  return {
    screen,
    ...(params !== undefined ? { params } : {}),
    initial: false,
  };
}
