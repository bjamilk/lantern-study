/**
 * Study's two peer sections: the set picker and the cross-set archive.
 *
 * They share the Study destination. They are not a sixth top-level tab.
 */
export const STUDY_AREA_SECTIONS = [
  { id: 'study', label: 'Study', shortLabel: 'Study' },
  { id: 'library', label: 'Library', shortLabel: 'Library' },
] as const;

export type StudyAreaSection = (typeof STUDY_AREA_SECTIONS)[number]['id'];

export function isStudyAreaSection(value: unknown): value is StudyAreaSection {
  return value === 'study' || value === 'library';
}
