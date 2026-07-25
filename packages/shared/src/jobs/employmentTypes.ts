export const JOB_EMPLOYMENT_TYPES = [
  'gig',
  'tutoring',
  'part_time',
  'campus_org',
  'research',
  'internship',
  'full_time',
  'contract',
] as const;

export type JobEmploymentType = (typeof JOB_EMPLOYMENT_TYPES)[number];

export const JOB_EMPLOYMENT_TYPE_LABELS: Record<JobEmploymentType, string> = {
  gig: 'Gig / one-off',
  tutoring: 'Tutoring',
  part_time: 'Part-time',
  campus_org: 'Campus org / faculty',
  research: 'Research / RA',
  internship: 'Internship',
  full_time: 'Full-time',
  contract: 'Contract',
};

/** Types allowed for peer / campus-org posters in Phase 1. */
export const JOB_PHASE1_EMPLOYMENT_TYPES: JobEmploymentType[] = [
  'gig',
  'tutoring',
  'part_time',
  'campus_org',
  'research',
];

export const JOB_PHASE2_EMPLOYMENT_TYPES: JobEmploymentType[] = [
  ...JOB_PHASE1_EMPLOYMENT_TYPES,
  'internship',
  'full_time',
  'contract',
];

export function isJobEmploymentType(value: unknown): value is JobEmploymentType {
  return typeof value === 'string' && (JOB_EMPLOYMENT_TYPES as readonly string[]).includes(value);
}
