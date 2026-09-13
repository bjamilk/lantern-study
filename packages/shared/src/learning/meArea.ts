/**
 * Profile's two peer sections: the account menu and the progress hub.
 *
 * They share the Profile destination (still the fifth tab). They are not a
 * sixth top-level tab.
 */
export const ME_AREA_SECTIONS = [
  { id: 'profile', label: 'Profile', shortLabel: 'Profile' },
  { id: 'progress', label: 'Progress', shortLabel: 'Progress' },
] as const;

export type MeAreaSection = (typeof ME_AREA_SECTIONS)[number]['id'];

export function isMeAreaSection(value: unknown): value is MeAreaSection {
  return value === 'profile' || value === 'progress';
}
