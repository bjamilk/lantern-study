/**
 * Hiring-pipeline reminders: nudges a candidate before a confirmed interview,
 * and nudges both sides before an offer's respond-by deadline lapses.
 *
 * Runs on the same cadence as job alerts. Every delivered nudge is recorded in
 * `job_reminders_sent`, so a sweep that runs every 15 minutes cannot resend the
 * same round.
 */
import {
  JOB_INTERVIEW_REMINDER_LEAD_MINUTES,
  JOB_OFFER_REMINDER_LEAD_MINUTES,
  describeJobReminderLead,
  dueJobReminderLead,
  jobReminderKey,
  minutesUntil,
} from "@lantern/shared/jobs";
import type { DataLayer } from "./data";
import { logger } from "../utils/logger";

export const JOB_INTERVIEW_REMINDER_NOTIFICATION_TYPE =
  "job_interview_reminder";
export const JOB_OFFER_REMINDER_NOTIFICATION_TYPE = "job_offer_reminder";

/**
 * How far ahead to look. Anything beyond the longest lead time cannot be due
 * yet, so there is no reason to load it.
 */
const LOOKAHEAD_MINUTES =
  Math.max(
    ...JOB_INTERVIEW_REMINDER_LEAD_MINUTES,
    ...JOB_OFFER_REMINDER_LEAD_MINUTES,
  ) + 15;

/** Rows per sweep. A backlog larger than this is a signal, not a workload. */
const SCAN_LIMIT = 200;

export interface JobReminderSweepResult {
  interviews: number;
  offers: number;
}

export async function processJobDeadlineReminders(
  layer: DataLayer,
): Promise<JobReminderSweepResult> {
  const now = new Date();
  const [interviews, offers] = await Promise.all([
    remindUpcomingInterviews(layer, now),
    remindExpiringOffers(layer, now),
  ]);

  if (interviews || offers) {
    logger.info("Job pipeline reminders sent", { interviews, offers });
  }
  return { interviews, offers };
}

/**
 * Claims a reminder by inserting its key. Returns false when the row already
 * exists, which is what makes the sweep safe to run repeatedly — and safe to
 * run in two processes at once, since the unique constraint decides the winner
 * rather than a read-then-write race.
 */
async function claimReminder(
  layer: DataLayer,
  userId: string,
  key: string,
): Promise<boolean> {
  const { error } = await layer
    .getClient()
    .from("job_reminders_sent")
    .insert({ user_id: userId, reminder_key: key });
  if (!error) return true;
  // 23505 is a unique violation: someone already sent this exact round.
  if ((error as { code?: string }).code !== "23505") {
    logger.warn("Could not claim job reminder", { key, error: error.message });
  }
  return false;
}

async function remindUpcomingInterviews(
  layer: DataLayer,
  now: Date,
): Promise<number> {
  const db = layer.getClient();
  const horizon = new Date(now.getTime() + LOOKAHEAD_MINUTES * 60000);
  const { data, error } = await db
    .from("job_interviews")
    .select(
      "id, application_id, posting_id, applicant_id, created_by, scheduled_at, status, mode, duration_minutes, posting:job_postings(id, title)",
    )
    .eq("status", "confirmed")
    .gt("scheduled_at", now.toISOString())
    .lte("scheduled_at", horizon.toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(SCAN_LIMIT);

  if (error) {
    logger.error("Failed to load interviews for reminders", {
      error: error.message,
    });
    return 0;
  }

  let sent = 0;
  for (const row of data || []) {
    const lead = dueJobReminderLead(
      minutesUntil(row.scheduled_at, { now }),
      JOB_INTERVIEW_REMINDER_LEAD_MINUTES,
    );
    if (lead == null) continue;

    const posting: any = Array.isArray(row.posting)
      ? row.posting[0]
      : row.posting;
    const title = posting?.title || "a job";
    const when = describeJobReminderLead(lead);
    const key = jobReminderKey("interview", row.id, lead);

    // Both sides are reminded: an employer who forgets is as costly as a
    // candidate who does.
    for (const [userId, link] of [
      [row.applicant_id, "/marketplace/applications"],
      [row.created_by, `/marketplace/employer/jobs/${row.posting_id}`],
    ] as const) {
      if (!userId) continue;
      if (!(await claimReminder(layer, userId, key))) continue;
      const notification = await layer.notifications.createNotification(userId, {
        type: JOB_INTERVIEW_REMINDER_NOTIFICATION_TYPE,
        message: `Interview for "${title}" is ${when}`,
        link,
        data: {
          interviewId: row.id,
          applicationId: row.application_id,
          postingId: row.posting_id,
        },
      });
      if (notification) sent += 1;
    }
  }
  return sent;
}

async function remindExpiringOffers(
  layer: DataLayer,
  now: Date,
): Promise<number> {
  const db = layer.getClient();
  const horizon = new Date(now.getTime() + LOOKAHEAD_MINUTES * 60000);
  const { data, error } = await db
    .from("job_offers")
    .select(
      "id, application_id, posting_id, applicant_id, created_by, expires_at, status, posting:job_postings(id, title)",
    )
    .eq("status", "sent")
    .gt("expires_at", now.toISOString())
    .lte("expires_at", horizon.toISOString())
    .order("expires_at", { ascending: true })
    .limit(SCAN_LIMIT);

  if (error) {
    logger.error("Failed to load offers for reminders", {
      error: error.message,
    });
    return 0;
  }

  let sent = 0;
  for (const row of data || []) {
    const lead = dueJobReminderLead(
      minutesUntil(row.expires_at, { now }),
      JOB_OFFER_REMINDER_LEAD_MINUTES,
    );
    if (lead == null) continue;

    const posting: any = Array.isArray(row.posting)
      ? row.posting[0]
      : row.posting;
    const title = posting?.title || "a job";
    const when = describeJobReminderLead(lead);
    const key = jobReminderKey("offer", row.id, lead);

    // The candidate is chased to answer; the employer is told it is about to
    // lapse so they can extend it or move on.
    const targets: Array<readonly [string, string, string]> = [
      [
        row.applicant_id,
        "/marketplace/applications",
        `Your offer for "${title}" expires ${when}`,
      ],
      [
        row.created_by,
        `/marketplace/employer/jobs/${row.posting_id}`,
        `Your offer for "${title}" is still unanswered and expires ${when}`,
      ],
    ];

    for (const [userId, link, message] of targets) {
      if (!userId) continue;
      if (!(await claimReminder(layer, userId, key))) continue;
      const notification = await layer.notifications.createNotification(userId, {
        type: JOB_OFFER_REMINDER_NOTIFICATION_TYPE,
        message,
        link,
        data: {
          offerId: row.id,
          applicationId: row.application_id,
          postingId: row.posting_id,
        },
      });
      if (notification) sent += 1;
    }
  }
  return sent;
}
