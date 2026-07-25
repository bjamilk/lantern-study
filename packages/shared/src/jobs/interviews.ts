/**
 * Interview scheduling rules shared by the employer pipeline, the candidate's
 * application list, and the API. An interview starts as a set of times the
 * employer offers; the candidate picks one, which is what turns it into a
 * confirmed meeting.
 */

export type JobInterviewMode = "video" | "phone" | "onsite";

export type JobInterviewStatus =
  | "proposed"
  | "confirmed"
  | "declined"
  | "cancelled"
  | "completed";

export interface JobInterview {
  id: string;
  applicationId: string;
  postingId: string;
  applicantId: string;
  /** Employer or company member who scheduled it. */
  createdBy: string;
  mode: JobInterviewMode;
  status: JobInterviewStatus;
  durationMinutes: number;
  /** Meeting link, phone number, or address, depending on `mode`. */
  locationText?: string | null;
  /** Anything else the candidate should know before joining. */
  details?: string | null;
  /** Times the employer offered, ISO 8601, ascending. */
  proposedSlots: string[];
  /** The time the candidate accepted. Null until then. */
  scheduledAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export const JOB_INTERVIEW_MODES: readonly JobInterviewMode[] = [
  "video",
  "phone",
  "onsite",
];

export const JOB_INTERVIEW_MODE_LABELS: Record<JobInterviewMode, string> = {
  video: "Video call",
  phone: "Phone call",
  onsite: "In person",
};

/** What the employer should put in `locationText` for each mode. */
export const JOB_INTERVIEW_LOCATION_LABELS: Record<JobInterviewMode, string> = {
  video: "Meeting link",
  phone: "Phone number",
  onsite: "Address",
};

export const JOB_INTERVIEW_STATUS_LABELS: Record<JobInterviewStatus, string> = {
  proposed: "Awaiting candidate",
  confirmed: "Confirmed",
  declined: "Times declined",
  cancelled: "Cancelled",
  completed: "Completed",
};

export const JOB_INTERVIEW_MAX_SLOTS = 5;
export const JOB_INTERVIEW_MIN_DURATION_MINUTES = 15;
export const JOB_INTERVIEW_MAX_DURATION_MINUTES = 480;
export const JOB_INTERVIEW_DEFAULT_DURATION_MINUTES = 30;
export const JOB_INTERVIEW_DETAILS_MAX_LENGTH = 1000;
export const JOB_INTERVIEW_LOCATION_MAX_LENGTH = 500;

export function isJobInterviewMode(value: unknown): value is JobInterviewMode {
  return (
    typeof value === "string" &&
    JOB_INTERVIEW_MODES.includes(value as JobInterviewMode)
  );
}

export function isJobInterviewStatus(
  value: unknown,
): value is JobInterviewStatus {
  return (
    typeof value === "string" &&
    value in (JOB_INTERVIEW_STATUS_LABELS as Record<string, string>)
  );
}

/**
 * Turns raw slot input into a clean ascending list. Past times are dropped so a
 * candidate is never asked to accept a slot they cannot attend, and duplicates
 * are collapsed at minute precision because seconds are noise here.
 */
export function normalizeJobInterviewSlots(
  input: unknown,
  options?: { now?: Date },
): string[] {
  const raw = Array.isArray(input) ? input : [];
  const now = options?.now ?? new Date();
  const byMinute = new Map<number, string>();

  for (const entry of raw) {
    if (typeof entry !== "string" && !(entry instanceof Date)) continue;
    const parsed = entry instanceof Date ? entry : new Date(entry);
    const time = parsed.getTime();
    if (!Number.isFinite(time)) continue;
    if (time <= now.getTime()) continue;
    const minute = Math.floor(time / 60000);
    if (!byMinute.has(minute)) {
      byMinute.set(minute, new Date(minute * 60000).toISOString());
    }
  }

  return Array.from(byMinute.entries())
    .sort((a, b) => a[0] - b[0])
    .slice(0, JOB_INTERVIEW_MAX_SLOTS)
    .map(([, iso]) => iso);
}

export function clampJobInterviewDuration(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  if (!Number.isFinite(parsed)) {
    return JOB_INTERVIEW_DEFAULT_DURATION_MINUTES;
  }
  return Math.min(
    JOB_INTERVIEW_MAX_DURATION_MINUTES,
    Math.max(JOB_INTERVIEW_MIN_DURATION_MINUTES, Math.round(parsed)),
  );
}

/** Statuses where the interview still represents a live commitment. */
export const JOB_INTERVIEW_ACTIVE_STATUSES: readonly JobInterviewStatus[] = [
  "proposed",
  "confirmed",
];

export function isJobInterviewActive(status: JobInterviewStatus): boolean {
  return JOB_INTERVIEW_ACTIVE_STATUSES.includes(status);
}

export function canApplicantRespondToJobInterview(
  status: JobInterviewStatus,
): boolean {
  return status === "proposed";
}

export function canEmployerCancelJobInterview(
  status: JobInterviewStatus,
): boolean {
  return status === "proposed" || status === "confirmed";
}

export function canEmployerCompleteJobInterview(
  status: JobInterviewStatus,
): boolean {
  return status === "confirmed";
}

/** Declined times are reschedulable: that is the point of declining them. */
export function canEmployerRescheduleJobInterview(
  status: JobInterviewStatus,
): boolean {
  return (
    status === "proposed" || status === "confirmed" || status === "declined"
  );
}

/**
 * Guards every status write. `actor` matters because a candidate accepting and
 * an employer cancelling are different moves from the same starting point.
 */
export function canSetJobInterviewStatus(
  from: JobInterviewStatus,
  to: JobInterviewStatus,
  actor: "employer" | "applicant",
): boolean {
  if (from === to) return false;
  if (from === "cancelled" || from === "completed") return false;

  if (actor === "applicant") {
    if (from !== "proposed") return false;
    return to === "confirmed" || to === "declined";
  }

  if (to === "cancelled") return canEmployerCancelJobInterview(from);
  if (to === "completed") return canEmployerCompleteJobInterview(from);
  // Employers reschedule instead of hand-editing status into these states.
  return false;
}

/**
 * Finds the offered slot a candidate is accepting. Matching is done at minute
 * precision so a client that re-serializes the timestamp (or drops
 * milliseconds) still lines up with the stored value. Returns null when the
 * request does not correspond to something that was actually offered, which is
 * what stops a candidate from booking a time of their own choosing.
 */
export function matchJobInterviewSlot(
  offered: string[],
  requested: unknown,
): string | null {
  if (typeof requested !== "string" && !(requested instanceof Date)) {
    return null;
  }
  const parsed = requested instanceof Date ? requested : new Date(requested);
  const minute = Math.floor(parsed.getTime() / 60000);
  if (!Number.isFinite(minute)) return null;
  const match = (offered || []).find(
    (candidate) => Math.floor(new Date(candidate).getTime() / 60000) === minute,
  );
  return match ?? null;
}

export function nextJobInterviewSlot(
  interview: Pick<JobInterview, "status" | "scheduledAt" | "proposedSlots">,
  options?: { now?: Date },
): string | null {
  const now = (options?.now ?? new Date()).getTime();
  if (interview.status === "confirmed" && interview.scheduledAt) {
    return new Date(interview.scheduledAt).getTime() > now
      ? interview.scheduledAt
      : null;
  }
  if (interview.status !== "proposed") return null;
  const upcoming = (interview.proposedSlots || []).filter(
    (slot) => new Date(slot).getTime() > now,
  );
  return upcoming[0] ?? null;
}

export function isJobInterviewUpcoming(
  interview: Pick<JobInterview, "status" | "scheduledAt" | "proposedSlots">,
  options?: { now?: Date },
): boolean {
  return nextJobInterviewSlot(interview, options) !== null;
}

/**
 * One-line schedule summary, e.g. "Video call · Confirmed for Mon, Aug 3,
 * 10:00 AM (30 min)". Locale formatting is left to the runtime so each client
 * renders in the viewer's own timezone.
 */
export function describeJobInterviewSchedule(
  interview: Pick<
    JobInterview,
    "mode" | "status" | "scheduledAt" | "proposedSlots" | "durationMinutes"
  >,
  options?: { locale?: string },
): string {
  const mode = JOB_INTERVIEW_MODE_LABELS[interview.mode] || "Interview";
  const duration = `${interview.durationMinutes} min`;
  const format = (iso: string) =>
    new Date(iso).toLocaleString(options?.locale, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

  if (interview.status === "confirmed" && interview.scheduledAt) {
    return `${mode} · ${format(interview.scheduledAt)} (${duration})`;
  }
  if (interview.status === "proposed") {
    const slots = interview.proposedSlots || [];
    const only = slots.length === 1 ? slots[0] : undefined;
    if (!slots.length) return `${mode} · awaiting times`;
    if (only) {
      return `${mode} · proposed ${format(only)} (${duration})`;
    }
    return `${mode} · ${slots.length} times proposed (${duration})`;
  }
  return `${mode} · ${JOB_INTERVIEW_STATUS_LABELS[interview.status]}`;
}

/** Slot list for message bodies, where locale-aware formatting is unavailable. */
export function formatJobInterviewSlotList(
  slots: string[],
  options?: { locale?: string; timeZone?: string },
): string {
  return slots
    .map(
      (slot, index) =>
        `${index + 1}. ${new Date(slot).toLocaleString(options?.locale, {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZone: options?.timeZone,
          timeZoneName: "short",
        })}`,
    )
    .join("\n");
}
