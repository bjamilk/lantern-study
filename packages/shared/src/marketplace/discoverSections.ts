/**
 * Which Discover sections are switched on.
 *
 * Founder decision 2026-08-30: hide Community, Groups and People so the app
 * concentrates on Marketplace and Jobs, which now own bottom-tab
 * destinations. This is a HIDE, not a delete — every screen, route and API
 * behind those sections is untouched, so flipping a flag back to true
 * restores them.
 *
 * 2026-09-02: Community is back on. It is reached from the mobile profile
 * drawer (Community · Jobs · Low-data · Dark mode · Settings), still behind
 * the platform-admin gate the Discover hub has always had. Groups and People
 * stay hidden.
 *
 * Web and mobile both read this so the two cannot drift.
 */
export type DiscoverSectionId = 'communities' | 'groups' | 'people' | 'rooms' | 'marketplace';

export const DISCOVER_SECTION_ENABLED: Record<DiscoverSectionId, boolean> = {
  communities: true,
  groups: false,
  people: false,
  // Temporary study rooms (24h). Added 2026-09-02 as the mobile hub's second
  // tab, taking the slot Market used to hold there; the web bar does not list
  // it yet, so on web this flag is inert.
  rooms: true,
  marketplace: true,
};

export function isDiscoverSectionEnabled(id: DiscoverSectionId): boolean {
  return DISCOVER_SECTION_ENABLED[id] === true;
}

export function enabledDiscoverSections(): DiscoverSectionId[] {
  return (Object.keys(DISCOVER_SECTION_ENABLED) as DiscoverSectionId[]).filter(
    isDiscoverSectionEnabled
  );
}

/** The section Discover opens on, given what is enabled. */
export function defaultDiscoverSection(): DiscoverSectionId {
  return enabledDiscoverSections()[0] ?? 'marketplace';
}
