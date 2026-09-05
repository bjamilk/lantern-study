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
