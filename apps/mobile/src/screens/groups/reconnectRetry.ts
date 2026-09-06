/**
 * Whether the chat list should fire its one automatic retry right now.
 *
 * The retry is ONE SHOT PER RECONNECTION, and the reason it has to be armed
 * explicitly is the store: `groupStore.fetchGroups` clears `listError` the
 * moment a fetch starts and sets it again if the fetch fails. An effect keyed
 * on `listError` therefore sees `"msg" -> null -> "msg"` on every failed retry
 * — a dependency change each time — and would schedule a fresh timer after
 * each failure. With Wi-Fi up but Lantern unreachable (API down, captive
 * portal, hotspot with no internet) that is an unbounded retry loop, every
 * ~1.5 s, for as long as the screen is open.
 *
 * `alreadyRetried` is the latch: set when the shot fires, cleared only when
 * connectivity actually drops, so a failed retry cannot re-arm itself.
 *
 * Pure and import-free so mobile jest (node env, *.test.ts only) can reach it.
 */
export interface ReconnectRetryInput {
  /** NetInfo's verdict on the link. */
  isConnected: boolean;
  /** The one automatic shot for this connection has already been fired. */
  alreadyRetried: boolean;
  /** The chat list's last load failed (`listError` is set). */
  listFailed: boolean;
  /** Either server-backed search failed. */
  searchFailed: boolean;
}

export interface ReconnectRetryPlan {
  /** Schedule the single delayed retry. */
  schedule: boolean;
  /** The link is down: clear the latch so the NEXT reconnection gets a shot. */
  resetLatch: boolean;
}

export function planReconnectRetry(input: ReconnectRetryInput): ReconnectRetryPlan {
  const { isConnected, alreadyRetried, listFailed, searchFailed } = input;
  if (!isConnected) return { schedule: false, resetLatch: true };
  if (alreadyRetried) return { schedule: false, resetLatch: false };
  if (!listFailed && !searchFailed) return { schedule: false, resetLatch: false };
  return { schedule: true, resetLatch: false };
}
