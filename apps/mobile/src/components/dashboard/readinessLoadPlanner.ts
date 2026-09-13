/**
 * When Home's "Exam readiness" card is allowed to fetch, and when what it is
 * already showing has to be dropped first.
 *
 * WHY THIS EXISTS
 * ---------------
 * The card used to load inside `useEffect(..., [])`. One fetch, ever. A load
 * that happened to land while the radio was off latched
 * `{ status: 'failed' }` and NOTHING could clear it: pull-to-refresh refreshed
 * the screen around it, the tab kept the screen mounted so returning to Home
 * re-ran no effect, and a theme change remounted the tree but restored the
 * same first-and-only fetch. A student who came back into signal watched
 * streak and XP recover on the same screen while readiness kept saying
 * "We could not load your readiness just now" until the app was killed.
 *
 * So the card now has four triggers — the account changing, focus,
 * pull-to-refresh and connectivity coming back — and this decides what each
 * one does. Pure and import-free so mobile jest (node env, `*.test.ts` only)
 * can reach it.
 */
export type ReadinessLoadTrigger =
  /** First render, and any later change of signed-in account. */
  | 'user-changed'
  /** The Home tab was focused (it stays mounted, so this is the return path). */
  | 'focus'
  /** The student pulled the screen down. */
  | 'pull-to-refresh'
  /** NetInfo went from down to up. */
  | 'reconnected';

export type ReadinessLoadStatus = 'loading' | 'ready' | 'failed' | 'empty';

/**
 * How long the card is allowed to sit in `loading` before it settles into the
 * honest empty state. Build 199's device pass found Home rendering SEVEN
 * regions instead of eight: with no saved exam date the slot falls to this
 * card, the card starts in `loading`, and `loading` used to render `null`. Any
 * plan that never starts a fetch — or a fetch that never answers — left a
 * silent blank where the exam slot goes, which is exactly what the card's own
 * header comment promises never to do.
 */
export const READINESS_LOADING_TIMEOUT_MS = 8000;

/** What the card draws for a given status. Never `null` — that was the bug. */
export type ReadinessCardBody = 'skeleton' | 'failed' | 'empty' | 'rows';

export function readinessCardBody(
  status: ReadinessLoadStatus,
  rowCount: number
): ReadinessCardBody {
  if (status === 'loading') return 'skeleton';
  if (status === 'failed') return 'failed';
  if (status === 'ready' && rowCount > 0) return 'rows';
  return 'empty';
}

export interface ReadinessLoadInput {
  trigger: ReadinessLoadTrigger;
  /** What the card is showing right now. */
  status: ReadinessLoadStatus;
  /** A fetch is already out and has not answered. */
  inFlight: boolean;
  /** The signed-in account, or null when there is none. */
  userId: string | null;
  /** The account the shown state was loaded for; null before the first answer. */
  loadedForUserId: string | null;
}

export interface ReadinessLoadPlan {
  /** Start a fetch. */
  fetch: boolean;
  /**
   * Clear what is on screen — the courses AND the failure — before the answer
   * arrives, because it belongs to somebody else (or to nobody).
   */
  reset: boolean;
  /**
   * No fetch is coming and none is already out, so the card must NOT be left
   * sitting in `loading` — it settles into the honest empty state instead.
   * `loading` with nothing in the air is a permanent blank card.
   */
  settle: boolean;
}

export function planReadinessLoad(input: ReadinessLoadInput): ReadinessLoadPlan {
  const { trigger, status, inFlight, userId, loadedForUserId } = input;

  // Signed out. Whatever is on screen is another account's, so it goes, and
  // there is nobody to fetch for — which is why this settles rather than
  // leaving the card waiting on an answer that can never arrive.
  if (!userId) return { fetch: false, reset: true, settle: true };

  // A different account than the one on screen. This one always fetches, even
  // mid-flight: the answer still coming back is for the previous student and
  // the caller discards it by request token.
  if (loadedForUserId && loadedForUserId !== userId) {
    return { fetch: true, reset: true, settle: false };
  }

  // One request at a time. Focus fires alongside the first mount effect, and
  // a student can pull while a fetch is already out; neither should double up.
  // A request IS out, so the card keeps waiting on it rather than settling.
  if (inFlight) return { fetch: false, reset: false, settle: false };

  // Coming back into signal only refetches something that is broken or has
  // never answered. A card already showing courses is not stale merely because
  // the Wi-Fi blinked, and focus and pull-to-refresh cover freshness.
  if (trigger === 'reconnected' && status === 'ready') {
    return { fetch: false, reset: false, settle: true };
  }

  // The failure is NOT cleared here on purpose. It stays on screen under the
  // refresh spinner until the new answer replaces it, so a refetch does not
  // blank the card for a beat — the fix is that the answer now arrives at all.
  return { fetch: true, reset: false, settle: false };
}
