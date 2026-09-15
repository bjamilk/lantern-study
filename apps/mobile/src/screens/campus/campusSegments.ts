/**
 * Campus is ONE destination with three segments: Communities · Shop · Jobs.
 *
 * Pure on purpose (imports nothing) so jest's node environment can test it —
 * see components/layout/tabRouting.ts for the same rationale.
 *
 * The rule this file enforces: a segment is HIDDEN while its gate is closed,
 * so Campus never shows a segment with nothing behind it. Shop and Jobs have no
 * gate any more (2026-09-15 — the private-pilot allowlist is gone), so
 * Communities is the only segment that can be missing, and only for a student
 * whose profile does not yet name an institution and a programme.
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
   * The shared academic-profile gate AND the `communities` section flag,
   * already resolved by the caller (both are synchronous).
   */
  canSeeCommunities: boolean;
}

/**
 * The segments this account may see, in the order Campus draws them.
 *
 * Never empty: Shop and Jobs are open to every viewer, so the bar always has
 * somewhere to go even before a profile names an institution.
 */
export function resolveCampusSegments({
  canSeeCommunities,
}: CampusGateState): CampusSegment[] {
  const segments: CampusSegment[] = [];
  if (canSeeCommunities) segments.push('communities');
  segments.push('shop');
  segments.push('jobs');
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
 * The app-bar title OVERRIDE while the Campus tab is lit — `null` to keep the
 * default (`tabTitle('Campus')` → "Campus"), a string to replace it.
 *
 * THE TWO-BAR RULE (TopBar.tsx, tabRouting.ts): the app-bar names the SECTION
 * you are in — the lit bottom tab — not the individual screen. Pushed, non-tab
 * screens draw their OWN header with a back arrow and their real name; the
 * shared app-bar only ever names the destination. Under that rule the Campus
 * tab's title is simply "Campus", one string per feature, and that is exactly
 * what Communities and Jobs get.
 *
 * SHOP IS THE ONE EXCEPTION, and only because of the founder's replace-mode
 * decision (contextualBars.ts, 2026-09-08). Shop is a SEGMENT of Campus, but
 * its contextual row is `replace`: while you are in Shop the global five-tab bar
 * is gone and the bottom row is Shop's own Browse · Cart · You. Every OTHER
 * replace-mode section satisfies the two-bar rule for free, because the section
 * is itself a tab — Study is `replace` and the lit tab is already Study, so the
 * title, the bottom bar and the section all say "Study" with no help. Shop is
 * the only replace section nested INSIDE a tab, so the lit tab (Campus) is
 * Shop's PARENT: the app-bar names Campus while the whole bottom bar has become
 * Shop's, under an in-screen segment strip that still frames Shop as a mere peer
 * of Communities and Jobs — three signals disagreeing about one screen (the
 * 14-shop-browse-root finding).
 *
 * So the title rule is the one Study meets without trying: NAME THE SECTION THAT
 * OWNS THE BOTTOM BAR. When Shop has taken the global bar the section is Shop,
 * so the title reads "Shop"; the instant the global five return — a listing
 * detail with no row, switching to the Communities or Jobs segment, or leaving
 * Campus altogether — the section is Campus again and so is the title. This is
 * not a second rule bolted on for Shop; it is the SAME rule, made to hold for
 * the one case that silently broke it. (The cleaner fix would be for Shop not to
 * be `replace` at all — see the handover finding — but that mode is declared in
 * navigation/contextualBars.ts, which this lane does not own.)
 *
 * `shopOwnsBottomBar` is the chrome's own `replacesGlobalBar(contextual)` for
 * the focused route, passed in rather than computed here so this stays pure and
 * import-free and a node test can exercise it (house rule: the rule is pure, the
 * shell is thin). It is meaningful only under the Campus tab — Study's replace
 * row is Study's, and `tabTitle('Study')` already names it — so any other lit
 * tab returns `null` and keeps its own name untouched.
 */
export function campusAppBarTitleOverride({
  activeTab,
  shopOwnsBottomBar,
}: {
  /** The lit bottom tab (tabRouting `TabKey`), e.g. 'Campus'. */
  activeTab: string;
  /** `replacesGlobalBar(contextual)` for the focused route. */
  shopOwnsBottomBar: boolean;
}): string | null {
  if (activeTab !== 'Campus') return null;
  return shopOwnsBottomBar ? CAMPUS_SEGMENT_LABELS.shop : null;
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
