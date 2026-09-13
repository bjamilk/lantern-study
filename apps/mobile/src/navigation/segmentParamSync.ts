/**
 * A door's SEGMENT ask, adopted by the screen exactly once — and never sent back.
 *
 * The set contextual row's `Materials` door is `CourseRoom { segment:
 * 'materials' }` and its `Tests` door is `StudySetLibrary { kind: 'tests' }`
 * (navigation/contextualBars.ts). When the student is already standing on that
 * route, React Navigation's `navigate` does not remount anything: it MERGES the
 * params into the focused route and stops. So a screen that reads the param
 * once — `useState(kind ?? 'cards')` — never hears the press (build 204).
 *
 * Build 205 answered that with a MIRROR: adopt the param, and publish the
 * visible segment back whenever the two drift. That crashes the app (build 205
 * device pass, `Maximum update depth exceeded`), and the reason is worth
 * keeping written down, because the pair looks like a fixed point on paper:
 *
 *   Both effects run in the SAME commit, off the SAME render's snapshot. A bar
 *   press makes the param `materials` while the state still says `overview`.
 *   The adopt effect SCHEDULES `overview → materials`; the publish effect, one
 *   line later and still reading the pre-adopt `overview`, immediately writes
 *   `segment: 'overview'` back into the params. Next commit the two have
 *   swapped roles, and neither ever sees the other's result. Each round trip is
 *   a `setState` plus a `setParams`, for ever.
 *
 * So the sync is ONE-directional, per event:
 *
 * - the row's press is an ASK, carried in the params and adopted once, keyed by
 *   a TICKET (see {@link readSegmentRequest}) so a second press of the same
 *   door is heard as a second press rather than dropped as a duplicate value;
 * - the screen NEVER writes params. The one writer means there is no second
 *   writer to chase, which is the whole cure;
 * - what the screen is SHOWING is published to `stores/setRoomUiStore`, which
 *   is where the row reads its active pill from. The param is an inbox, not a
 *   mirror.
 *
 * Pure and import-free so mobile jest's node environment can exercise all of
 * it; the validator is passed in, which is what lets the room (five section ids)
 * and the set library (four artefact kinds) share one set of rules.
 */

/** A value the screen is allowed to be showing. */
export type SegmentGuard<T extends string> = (value: unknown) => value is T;

/**
 * What the screen should be showing on MOUNT.
 *
 * The param wins over the remembered segment when it names a real one: it is an
 * explicit instruction from the door that was just pressed, and the memory is
 * only ever a default. An absent or unrecognised param leaves the memory alone
 * — which is every existing caller, all of which pass no segment at all.
 */
export function initialSegment<T extends string>(
  param: unknown,
  isValid: SegmentGuard<T>,
  remembered: T,
): T {
  return isValid(param) ? param : remembered;
}

/** One press of one door. */
export interface SegmentRequest<T extends string> {
  /** The segment that door asked for. */
  segment: T;
  /**
   * Identity of the ASK, not of the value.
   *
   * Two presses of `Materials` either side of a row tap are two asks that name
   * the same segment, and the second one must still be heard. Comparing values
   * cannot tell them apart; comparing tickets can.
   */
  ticket: unknown;
}

/**
 * The door's ask, read out of the focused route's params.
 *
 * Two shapes are understood, and they differ only in where the ticket comes
 * from:
 *
 * - `{ segment: { segment, nonce } }` — an explicit ticket, for when the row is
 *   taught to mint one per press;
 * - `{ segment: 'materials' }` — today's shape, whose ticket is the PARAMS
 *   OBJECT ITSELF. React Navigation rebuilds `route.params` on every navigate
 *   and on nothing else, so its identity already is a per-press ticket —
 *   *provided* the screen never calls `setParams`, which is exactly the rule
 *   this module now enforces.
 */
export function readSegmentRequest<T extends string>(
  params: unknown,
  key: string,
  isValid: SegmentGuard<T>,
): SegmentRequest<T> | null {
  if (!params || typeof params !== 'object') return null;
  const raw = (params as Record<string, unknown>)[key];
  if (raw && typeof raw === 'object') {
    const ticketed = raw as { segment?: unknown; nonce?: unknown };
    if (!isValid(ticketed.segment)) return null;
    return { segment: ticketed.segment, ticket: `${key}#${String(ticketed.nonce)}` };
  }
  if (!isValid(raw)) return null;
  return { segment: raw, ticket: params };
}

/** What one adoption did, or `null` when there was nothing to adopt. */
export interface SegmentAdoption<T extends string> {
  /** The segment to show. */
  segment: T;
  /** Remember this, and never adopt it twice. */
  ticket: unknown;
  /**
   * The ask named the segment already on screen: a press of the door you are
   * standing in. Nothing moves; the screen may scroll to top.
   */
  alreadyShown: boolean;
}

/**
 * Adopt a door's ask, at most once per ticket.
 *
 * `null` for no ask, an unreadable one, or a ticket already spent — never for
 * an ask that happens to name the visible segment, because that is a real
 * press and the screen is allowed to answer it (by scrolling, not by moving).
 */
export function adoptSegmentRequest<T extends string>(input: {
  request: SegmentRequest<T> | null;
  /** The ticket this screen last adopted; the mount's params count as spent. */
  lastTicket: unknown;
  /** What the screen is showing right now. */
  current: T;
}): SegmentAdoption<T> | null {
  const { request, lastTicket, current } = input;
  if (!request) return null;
  if (request.ticket === lastTicket) return null;
  return {
    segment: request.segment,
    ticket: request.ticket,
    alreadyShown: request.segment === current,
  };
}
