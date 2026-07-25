/**
 * Which status changes an employer may make to their own posting, and which
 * belong to moderation. Shared so the buttons a client offers and the
 * transitions the API accepts cannot disagree.
 */
import type { JobPostingStatus } from "./types";

export const JOB_POSTING_STATUSES: readonly JobPostingStatus[] = [
  "draft",
  "active",
  "paused",
  "closed",
  "pending_school_approval",
  "suspended_by_admin",
  "removed_by_admin",
];

export function isJobPostingStatus(value: unknown): value is JobPostingStatus {
  return (
    typeof value === "string" &&
    (JOB_POSTING_STATUSES as readonly string[]).includes(value)
  );
}

/** Set by moderation only. An employer can never enter or leave these. */
export const JOB_MODERATED_POSTING_STATUSES: readonly JobPostingStatus[] = [
  "suspended_by_admin",
  "removed_by_admin",
];

/**
 * A post held for school approval is also not the employer's to release —
 * they may withdraw it, but they cannot approve themselves.
 */
export function isJobPostingModerated(status: JobPostingStatus): boolean {
  return JOB_MODERATED_POSTING_STATUSES.includes(status);
}

/** Transitions an employer may perform, keyed by the posting's current status. */
const EMPLOYER_TRANSITIONS: Record<
  JobPostingStatus,
  readonly JobPostingStatus[]
> = {
  draft: ["active", "closed"],
  active: ["paused", "closed"],
  paused: ["active", "closed"],
  closed: ["active"],
  // Withdrawing is allowed; approving is not.
  pending_school_approval: ["closed"],
  suspended_by_admin: [],
  removed_by_admin: [],
};

export function canEmployerSetJobPostingStatus(
  from: JobPostingStatus,
  to: JobPostingStatus,
): boolean {
  if (from === to) return true;
  return EMPLOYER_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Content edits are blocked once moderation has taken the post down. */
export function isJobPostingEditable(status: JobPostingStatus): boolean {
  return !isJobPostingModerated(status);
}

/** Whether the post is visible to candidates in its current state. */
export function isJobPostingPubliclyVisible(status: JobPostingStatus): boolean {
  return status === "active";
}

/**
 * Statuses a non-owner may still open by direct link. Paused and closed posts
 * stay readable so past applicants can revisit what they applied to; drafts and
 * moderated posts are owner-only.
 */
export const JOB_POSTING_LINK_VISIBLE_STATUSES: readonly JobPostingStatus[] = [
  "active",
  "paused",
  "closed",
];

export function isJobPostingLinkVisible(status: JobPostingStatus): boolean {
  return JOB_POSTING_LINK_VISIBLE_STATUSES.includes(status);
}

export interface JobPostingStatusAction {
  status: JobPostingStatus;
  /** Verb for the button, e.g. "Pause". */
  label: string;
  /** Shown as confirmation or helper text. */
  description: string;
  destructive?: boolean;
}

const ACTION_COPY: Partial<Record<JobPostingStatus, JobPostingStatusAction>> = {
  active: {
    status: "active",
    label: "Publish",
    description: "Candidates can find and apply to this job.",
  },
  paused: {
    status: "paused",
    label: "Pause",
    description:
      "Hides the job from search. Existing applicants are unaffected.",
  },
  closed: {
    status: "closed",
    label: "Close",
    description: "Stops new applications. You can reopen it later.",
    destructive: true,
  },
  draft: {
    status: "draft",
    label: "Save as draft",
    description: "Only you can see this job.",
  },
};

/**
 * The status buttons to offer for a posting. "Publish" is relabelled to
 * "Reopen" from a closed or paused post, since nothing is being published anew.
 */
export function jobPostingStatusActions(
  status: JobPostingStatus,
): JobPostingStatusAction[] {
  const targets = EMPLOYER_TRANSITIONS[status] ?? [];
  return targets.flatMap((target) => {
    const action = ACTION_COPY[target];
    if (!action) return [];
    if (target === "active" && (status === "closed" || status === "paused")) {
      return [
        {
          ...action,
          label: "Reopen",
          description: "Puts the job back in search results.",
        },
      ];
    }
    return [action];
  });
}
