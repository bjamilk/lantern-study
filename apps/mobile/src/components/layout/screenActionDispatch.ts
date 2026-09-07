/**
 * Screen actions: the contextual row's third kind of press.
 *
 * Spec v3 §7.2 asks for two rows whose items are not screens and not the two
 * app-wide doors (Record, AI). On `NoteEditor` the row is "Learn · Cards ·
 * Test · AI" — and Learn and Cards are things the note editor DOES, in place,
 * to the note that is open. There is no route to navigate to and no store a
 * pure module could call: the work lives inside one screen's own state.
 *
 * So the registry names an intent (`{ kind: 'screenAction', action: 'noteFlashcards' }`)
 * and the screen that can honour it registers a handler WHILE IT IS FOCUSED.
 * The row looks the handler up and runs it; when nothing is registered the
 * press does nothing at all. That last part is the safety property worth
 * stating: an action is addressed to a route, so a handler left behind by a
 * screen that is still mounted underneath another one can never be run by the
 * row of the screen on top.
 *
 * Pure and IMPORT-FREE, like contextualBarLayout.ts next door: mobile jest
 * runs on the `node` environment and cannot transform a native module, so the
 * lookup rule lives here where it can be tested, and ChromeContext.tsx holds
 * only the Map and the React plumbing around it.
 */

/** What a screen registers. Fire-and-forget: the row never awaits it. */
export type ScreenActionHandler = () => void;

/**
 * Registry key for one route's one action.
 *
 * A NUL byte joins the two halves rather than `:` or `/` — a route name is a
 * developer-written identifier today, but a key built with a separator that
 * can occur inside either half is a collision waiting for the first route
 * called `Note:Editor`, and a mis-keyed action runs the wrong screen's work.
 */
export function screenActionKey(route: string, action: string): string {
  return `${route}\u0000${action}`;
}

export interface ScreenActionDispatchInput<H> {
  /** Every handler currently registered, keyed by {@link screenActionKey}. */
  handlers: ReadonlyMap<string, H>;
  /** The route the row belongs to — the focused one, per ChromeContext. */
  route: string | undefined;
  /** The action id the pressed item names. */
  action: string;
}

/**
 * `run` carries the handler to call; `none` says why there is nothing to do.
 *
 * The reason is not shown to anyone. It exists so a test can tell "the screen
 * has not registered this yet" from "the row was pressed with no focused
 * route", which are the same silence on screen and different bugs.
 */
export type ScreenActionDispatchPlan<H> =
  | { kind: 'run'; handler: H }
  | { kind: 'none'; reason: 'no-route' | 'no-action' | 'unregistered' };

/**
 * What a screen-action press means, given who is registered right now.
 *
 * Deliberately total and silent: a row item may be pressed in the frame
 * between a screen unmounting and the next one publishing its route, and the
 * honest answer there is to do nothing rather than to guess at a handler.
 */
export function planScreenActionDispatch<H>({
  handlers,
  route,
  action,
}: ScreenActionDispatchInput<H>): ScreenActionDispatchPlan<H> {
  if (!route) return { kind: 'none', reason: 'no-route' };
  if (!action) return { kind: 'none', reason: 'no-action' };
  const handler = handlers.get(screenActionKey(route, action));
  if (!handler) return { kind: 'none', reason: 'unregistered' };
  return { kind: 'run', handler };
}

/**
 * One screen's action map flattened into registry entries.
 *
 * The hook in ChromeContext.tsx takes `{ noteLearn: fn, noteFlashcards: fn }` from a screen
 * and adds each pair on focus; this is that translation, kept here so the key
 * format has exactly one implementation and the test can hold both ends of it.
 * An action whose handler is undefined is dropped rather than registered as a
 * dead entry — that is how a screen expresses "not this note", e.g. a note the
 * reader cannot edit offering no Cards.
 */
export function screenActionEntries<H>(
  route: string,
  actions: Readonly<Record<string, H | undefined>>
): Array<[string, H]> {
  const entries: Array<[string, H]> = [];
  for (const [action, handler] of Object.entries(actions)) {
    if (!action || handler === undefined) continue;
    entries.push([screenActionKey(route, action), handler]);
  }
  return entries;
}
