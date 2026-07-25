/**
 * Deadline reminders and calendar export for the hiring pipeline.
 *
 * Interviews and offers both turn worthless if someone simply forgets: a
 * confirmed interview nobody attends and an offer that lapses unanswered are
 * the two ways the previous phases quietly fail. These rules decide when to
 * nudge, and the calendar builders let a confirmed interview leave the app and
 * land somewhere the candidate actually looks.
 */
import type { JobInterview } from "./interviews";
import type { JobOffer } from "./offers";

export type JobReminderSubject = "interview" | "offer";

/**
 * How far ahead to nudge, in minutes, longest first. Two rounds: one the day
 * before so the person can plan, and one shortly before so they act.
 */
export const JOB_INTERVIEW_REMINDER_LEAD_MINUTES: readonly number[] = [
  24 * 60,
  60,
];

/** Offers get a longer final window, since answering one is not instant. */
export const JOB_OFFER_REMINDER_LEAD_MINUTES: readonly number[] = [
  24 * 60,
  2 * 60,
];

export function minutesUntil(
  iso: string | null | undefined,
  options?: { now?: Date },
): number | null {
  if (!iso) return null;
  const target = new Date(iso).getTime();
  if (!Number.isFinite(target)) return null;
  const now = (options?.now ?? new Date()).getTime();
  return (target - now) / 60000;
}

/**
 * The lead time to remind at right now, or null when nothing is due.
 *
 * Returns the *most urgent* crossed threshold rather than every crossed one:
 * an interview 30 minutes away has passed both the day-before and hour-before
 * marks, and sending two notifications at once would be noise. Picking the
 * smallest matching lead also means a late-scheduled event still gets its one
 * useful nudge instead of a stale "tomorrow" message.
 */
export function dueJobReminderLead(
  minutesRemaining: number | null,
  leads: readonly number[],
): number | null {
  if (minutesRemaining == null) return null;
  // Already started or passed: a reminder now is worse than none.
  if (minutesRemaining <= 0) return null;
  const crossed = leads.filter((lead) => minutesRemaining <= lead);
  if (!crossed.length) return null;
  return Math.min(...crossed);
}

/**
 * Stable dedupe key for a single nudge. The lead time is part of it so the
 * day-before and hour-before rounds are tracked independently, and re-running
 * the sweep every few minutes cannot resend either one.
 */
export function jobReminderKey(
  subject: JobReminderSubject,
  id: string,
  leadMinutes: number,
): string {
  return `${subject}:${id}:${leadMinutes}m`;
}

/** Human phrasing for the lead time, e.g. "in 1 hour" or "tomorrow". */
export function describeJobReminderLead(leadMinutes: number): string {
  if (leadMinutes >= 24 * 60) {
    const days = Math.round(leadMinutes / (24 * 60));
    return days === 1 ? "tomorrow" : `in ${days} days`;
  }
  if (leadMinutes >= 60) {
    const hours = Math.round(leadMinutes / 60);
    return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `in ${Math.round(leadMinutes)} minutes`;
}

/**
 * Whether this interview is something worth reminding about at all. Only a
 * confirmed time is a commitment; proposed slots are still a question.
 */
export function isJobInterviewRemindable(
  interview: Pick<JobInterview, "status" | "scheduledAt">,
): boolean {
  return interview.status === "confirmed" && !!interview.scheduledAt;
}

export function isJobOfferRemindable(
  offer: Pick<JobOffer, "status" | "expiresAt">,
): boolean {
  return offer.status === "sent" && !!offer.expiresAt;
}

// ─── Calendar export ────────────────────────────────────────────────────────

export interface JobInterviewCalendarEvent {
  /** Stable per-interview so re-importing updates rather than duplicates. */
  id: string;
  title: string;
  /** ISO 8601 start. */
  startsAt: string;
  durationMinutes: number;
  location?: string | null;
  description?: string | null;
}

/** ICS wants `YYYYMMDDTHHMMSSZ` with no punctuation. */
function toIcsStamp(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

/**
 * Escapes text for an ICS value. Backslash first, or the escapes we add would
 * themselves be escaped.
 */
function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * RFC 5545 caps content lines at 75 octets, continued with a leading space.
 * Long meeting links and pasted notes routinely exceed that, and some calendar
 * clients reject the whole file rather than the offending line.
 */
function foldIcsLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    parts.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  if (rest.length) parts.push(` ${rest}`);
  return parts.join("\r\n");
}

/**
 * A single-event ICS file. Times are emitted in UTC so the importing calendar
 * places the event correctly regardless of the timezone it is read in.
 */
export function buildJobInterviewIcs(
  event: JobInterviewCalendarEvent,
  options?: { now?: Date },
): string {
  const start = new Date(event.startsAt);
  const end = new Date(start.getTime() + event.durationMinutes * 60000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Lantern Study//Jobs//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:job-interview-${event.id}@lanternstudy.com`,
    `DTSTAMP:${toIcsStamp(options?.now ?? new Date())}`,
    `DTSTART:${toIcsStamp(start)}`,
    `DTEND:${toIcsStamp(end)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
  ];
  if (event.location) {
    lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  }
  if (event.description) {
    lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

/** Safe-ish download name, e.g. `interview-frontend-intern.ics`. */
export function jobInterviewIcsFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `interview-${slug || "scheduled"}.ics`;
}

/**
 * Google Calendar's event-creation URL. Used on mobile, where opening a link is
 * far more reliable than handing a downloaded file to another app.
 */
export function jobInterviewGoogleCalendarUrl(
  event: JobInterviewCalendarEvent,
): string {
  const start = new Date(event.startsAt);
  const end = new Date(start.getTime() + event.durationMinutes * 60000);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${toIcsStamp(start)}/${toIcsStamp(end)}`,
  });
  if (event.description) params.set("details", event.description);
  if (event.location) params.set("location", event.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
