/**
 * Campus is ONE destination with three segments: Communities · Shop · Jobs.
 *
 * Pure on purpose (imports nothing) so jest's node environment can test it —
 * see components/layout/tabRouting.ts for the same rationale.
 *
 * The rule this file enforces: a segment is HIDDEN while its gate is closed,
 * so Campus never shows a segment with nothing behind it. Both gates are
 * three-valued in practice — allowed, refused, or not answered yet — and the
 * "not answered yet" case must keep the segment visible: a failed or in-flight
 * probe must never quietly delete a destination.
 */

export type CampusSegment = 'communities' | 'shop' | 'jobs';

/** One name per feature, shared with the web sidebar's Campus page. */
export const CAMPUS_SEGMENT_LABELS: Record<CampusSegment, string> = {
  communities: 'Communities',
  shop: 'Shop',
  jobs: 'Jobs',
};

export interface CampusGateState {
  /**
   * The Discover hub's platform-admin gate AND the `communities` section flag,
   * already resolved by the caller (both are synchronous).
   */
  canSeeCommunities: boolean;
  /**
   * The marketplace private-pilot answer: `true` allowed, `false` refused,
   * `null` while the probe is in flight or after it failed. One allowlist
   * covers Shop and Jobs, so one answer gates both.
   */
  marketplaceAccess: boolean | null;
}

/**
 * The segments this account may see, in the order Campus draws them.
 *
 * Empty is a legitimate answer — a student on no pilot and outside the
 * Discover gate has nothing here yet — and the screen owes them an honest
 * empty state rather than a bar of dead tabs.
 */
export function resolveCampusSegments({
  canSeeCommunities,
  marketplaceAccess,
}: CampusGateState): CampusSegment[] {
  const segments: CampusSegment[] = [];
  if (canSeeCommunities) segments.push('communities');
  // `null` (unknown) keeps both visible; only a definite `false` hides them.
  if (marketplaceAccess !== false) {
    segments.push('shop');
    segments.push('jobs');
  }
  return segments;
}

/**
 * Which segment to show, given what the caller asked for (a deep link, a
 * legacy `navigate('MarketTab')`, or the last one the reader picked) and what
 * is actually available. `null` when Campus has nothing to show at all.
 */
export function resolveCampusSegment(
  requested: CampusSegment | undefined | null,
  available: readonly CampusSegment[]
): CampusSegment | null {
  if (requested && available.includes(requested)) return requested;
  return available[0] ?? null;
}

/** True when the segment bar is worth drawing: one segment is not a choice. */
export function shouldShowSegmentBar(available: readonly CampusSegment[]): boolean {
  return available.length > 1;
}

/**
 * Whether the screen should write `active` back into its own route params.
 *
 * The params are how the chrome sees which segment is showing (the Shop
 * contextual row keys on `Campus` + `segment: 'shop'`), so the visible segment
 * has to be published. There are TWO writers of the same param, though — the
 * reader's tap, and every `navigate('Campus', { segment })` from a redirect or
 * a deep link — and an effect that blindly re-publishes `active` whenever it
 * differs from the params fights the second one: the request effect copies the
 * new request into `picked` while this one writes the OLD pick back over it,
 * and the two alternate forever ("Maximum update depth exceeded").
 *
 * So the rule is: a request the screen has not yet adopted is never
 * overwritten. Publish only when the params carry NO request (first mount, or
 * a root reset that cleared them) or when the request has already been
 * adopted into `picked` and still does not match what is showing — which is
 * the one honest disagreement left, a request for a segment whose gate is
 * closed. The tap itself writes the param directly, so it never needs this.
 */
export function shouldPublishCampusSegment({
  requested,
  picked,
  active,
}: {
  /** `route.params.segment` — what the params say right now. */
  requested: CampusSegment | undefined | null;
  /** The screen's own last adoption of a request or a tap. */
  picked: CampusSegment | null;
  /** What is actually on screen (`resolveCampusSegment`). */
  active: CampusSegment | null;
}): boolean {
  if (!active) return false;
  if (requested === active) return false;
  if (requested && picked !== requested) return false;
  return true;
}
