/**
 * Jobs board compliance copy (Nigeria-wide listing platform).
 * Lantern is a listing platform — not the employer.
 */

export const JOBS_COMPLIANCE_BANNER =
  'Lantern Study Jobs is open across Nigeria for companies, campus orgs, and individuals. Campus or city details are optional and help with local discovery. Hiring terms and pay are arranged between the poster and the applicant. Lantern is not the employer.';

export const JOBS_CREATE_CONFIRMATION =
  'I confirm this job is real, any campus or city details I provide are accurate, compensation is stated honestly, and I will not ask applicants for BVN, NIN, bank details, or any fee to start.';

export const JOBS_COMPANY_EEO_NOTICE =
  'Lantern Study is an equal-opportunity listing platform. Employers must not discriminate on the basis of ethnicity, gender, religion, disability, or other protected characteristics under applicable Nigerian law.';

export const JOBS_COMPANY_DISCLAIMER =
  'Company job posts are advertisements. Lantern Study does not employ applicants and does not guarantee interviews or offers.';

/** Short safety tips shown on job detail (web + mobile). */
export const JOBS_CANDIDATE_SAFETY_TIPS = [
  'Never pay a fee, gift card, or crypto deposit to apply or start work.',
  'Do not send BVN, NIN, bank OTP, passwords, or full card details to a poster.',
  'Prefer verified companies and public meetups; report posts that feel off.',
] as const;

/** Applications older than this (days after posting closed) may be anonymized. */
export const JOBS_APPLICATION_RETENTION_DAYS = 540; // ~18 months

export const JOBS_DEFAULT_CURRENCY = 'NGN';
export const JOBS_DEFAULT_COUNTRY = 'NG';
