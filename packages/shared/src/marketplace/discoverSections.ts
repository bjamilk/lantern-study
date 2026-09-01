/**
 * Which Discover sections are switched on.
 *
 * Founder decision 2026-08-30: hide Community, Groups and People so the app
 * concentrates on Marketplace and Jobs, which now own bottom-tab
 * destinations. This is a HIDE, not a delete — every screen, route and API
 * behind those sections is untouched, so flipping a flag back to true
 * restores them.
 *
 * Web and mobile both read this so the two cannot drift.
 */
export type DiscoverSectionId = 'communities' | 'groups' | 'people' | 'marketplace';

export const DISCOVER_SECTION_ENABLED: Record<DiscoverSectionId, boolean> = {
  communities: false,
  groups: false,
  people: false,
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
