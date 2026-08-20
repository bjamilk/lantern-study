import type { JobApplicationStatus, JobPosting, JobPostingStatus } from './types';

export const JOB_POSTING_STATUS_LABELS: Record<JobPostingStatus, string> = {
  draft: 'Draft',
  active: 'Accepting applications',
  paused: 'Paused',
  closed: 'Closed',
  pending_school_approval: 'Awaiting school approval',
  suspended_by_admin: 'Suspended',
  removed_by_admin: 'Removed',
};

export const JOB_APPLICATION_STATUS_LABELS: Record<JobApplicationStatus, string> = {
  // "interested" is the stored status for a full Easy Apply to an individual
  // poster (companies get "new"), so candidates must read it as a sent
  // application, not a casual bookmark.
  interested: 'Application sent',
  chatting: 'Conversation started',
  new: 'Application sent',
  reviewing: 'Under review',
  interview: 'Interview',
  offer: 'Offer received',
  hired: 'Hired',
  rejected: 'Not selected',
  withdrawn: 'Withdrawn',
};

export const JOB_APPLICATION_STATUS_DESCRIPTIONS: Record<JobApplicationStatus, string> = {
  interested: 'Your application was sent to the poster.',
  chatting: 'You and the poster have started a conversation.',
  new: 'Your application was delivered to the employer.',
  reviewing: 'The employer is reviewing your application.',
  interview: 'The employer moved you to the interview stage.',
  offer: 'The employer has marked an offer for this role.',
  hired: 'You were hired for this role.',
  rejected: 'The employer is moving forward with other applicants.',
  withdrawn: 'This application was withdrawn.',
};

export function formatJobLocation(job: Pick<JobPosting, 'isRemote' | 'locationText' | 'campusName'>) {
  const localLocation = job.locationText?.trim() || job.campusName?.trim();
  if (job.isRemote && localLocation) return `Remote · ${localLocation}`;
  if (job.isRemote) return 'Remote';
  return localLocation || 'Location not specified';
}

export function formatJobPostedDate(value: string, now = new Date()): string {
  const createdAt = new Date(value);
  if (Number.isNaN(createdAt.getTime())) return '';

  const days = Math.max(
    0,
    Math.floor((now.getTime() - createdAt.getTime()) / (24 * 60 * 60 * 1000))
  );
  if (days === 0) return 'Posted today';
  if (days === 1) return 'Posted yesterday';
  if (days < 7) return `Posted ${days} days ago`;
  if (days < 14) return 'Posted 1 week ago';
  if (days < 35) return `Posted ${Math.floor(days / 7)} weeks ago`;
  return `Posted ${createdAt.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: createdAt.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  })}`;
}
