/**
 * Job alerts: turns newly published postings into notifications for the saved
 * searches they match. Runs on the same cadence as marketplace alerts.
 */
import {
  JOB_SAVED_SEARCH_MAX_MATCHES_PER_RUN,
  formatJobCompensation,
  jobPostingMatchesSearch,
  normalizeJobSearchFilters,
} from "@lantern/shared/jobs";
import { bestEffortWrite } from "./data/writeResult";
import { shouldSendEmailNotifications } from "@lantern/shared/settings";
import { isAlertMailConfigured, sendJobAlertEmail } from "./alertMail";
import type { DataLayer } from "./data";
import { logger } from "../utils/logger";

export const JOB_ALERT_NOTIFICATION_TYPE = "job_alert";

/** Rows scanned per search. A backlog larger than this is not worth replaying. */
const POSTING_SCAN_LIMIT = 50;

export async function processJobSavedSearchAlerts(
  layer: DataLayer,
): Promise<number> {
  const db = layer.getClient();
  const { data: searches, error } = await db
    .from("job_saved_searches")
    .select("id, user_id, name, filters, last_checked_at, created_at")
    .eq("notify", true);

  if (error) {
    logger.error("Failed to load job saved searches for alerts", {
      error: error.message,
    });
    return 0;
  }
  if (!searches?.length) return 0;

  let sent = 0;
  const now = new Date().toISOString();

  for (const search of searches) {
    const since = search.last_checked_at || search.created_at;
    const { data: postings, error: postingError } = await db
      .from("job_postings")
      .select(
        "id, title, description, employment_type, is_remote, campus_id, company_id, compensation, location_text, created_at",
      )
      .eq("status", "active")
      .gt("created_at", since)
      .order("created_at", { ascending: false })
      .limit(POSTING_SCAN_LIMIT);

    if (postingError) {
      logger.warn("Job alert posting query failed", {
        searchId: search.id,
        error: postingError.message,
      });
      continue;
    }

    const filters = normalizeJobSearchFilters(search.filters);
    const matches = (postings || [])
      .filter((posting: any) =>
        jobPostingMatchesSearch(
          {
            title: posting.title,
            description: posting.description,
            employmentType: posting.employment_type,
            isRemote: posting.is_remote,
            campusId: posting.campus_id,
            companyId: posting.company_id,
            compensation: posting.compensation,
          },
          filters,
        ),
      )
      .slice(0, JOB_SAVED_SEARCH_MAX_MATCHES_PER_RUN);

    if (matches.length) {
      const alreadyNotified = await notifiedPostingIds(
        layer,
        search.user_id,
        search.id,
      );
      const fresh = matches.filter((p: any) => !alreadyNotified.has(p.id));
      for (const posting of fresh) {
        // createNotification handles the in-app policy and, now that
        // job_alert is push-enabled, the Expo push delivery too.
        const notification = await layer.notifications.createNotification(
          search.user_id,
          {
            type: JOB_ALERT_NOTIFICATION_TYPE,
            message: `New match for "${search.name}": ${posting.title}`,
            link: `/marketplace/jobs/${posting.id}`,
            data: { savedSearchId: search.id, postingId: posting.id },
          },
        );
        if (notification) sent += 1;
      }
      if (fresh.length) {
        await maybeEmailDigest(layer, search, fresh);
      }
    }

    // Advance the watermark even with no matches, so the next run scans a
    // smaller window instead of re-reading the same rows forever.
    // BEST EFFORT (#108): the twin of `savedSearchMatches`. A lost stamp costs
    // a wider scan next run, and that run re-stamps it.
    bestEffortWrite(
      await db
        .from("job_saved_searches")
        .update({ last_checked_at: now })
        .eq("id", search.id),
      { table: "job_saved_searches", op: "update", searchId: search.id, reason: "alert_watermark" },
    );
  }

  if (sent > 0) {
    logger.info("Job saved search alerts sent", { count: sent });
  }
  return sent;
}

/**
 * One email per saved search per sweep, and only when the user has email
 * notifications on. Deduplication rides on the same watermark and
 * already-notified set as the in-app path, so a posting is emailed at most
 * once per search.
 */
async function maybeEmailDigest(
  layer: DataLayer,
  search: { id: string; user_id: string; name: string },
  fresh: Array<{
    id: string;
    title: string;
    compensation?: unknown;
    location_text?: string | null;
    is_remote?: boolean;
  }>,
): Promise<void> {
  if (!isAlertMailConfigured()) return;
  try {
    const db = layer.getClient();
    const { data: profile } = await db
      .from("profiles")
      .select("settings")
      .eq("id", search.user_id)
      .single();
    if (!shouldSendEmailNotifications(profile?.settings)) return;

    const { data: authUser } = await db.auth.admin.getUserById(search.user_id);
    const to = authUser?.user?.email;
    if (!to) return;

    const delivered = await sendJobAlertEmail({
      to,
      searchName: search.name || "your saved search",
      matches: fresh.map((posting) => ({
        id: posting.id,
        title: posting.title,
        compensationLabel: formatJobCompensation(posting.compensation as any),
        locationLabel: posting.is_remote
          ? "Remote"
          : posting.location_text || null,
      })),
    });
    if (delivered) {
      logger.info("Job alert email sent", {
        searchId: search.id,
        matches: fresh.length,
      });
    }
  } catch (err) {
    // Email is best-effort; the in-app notification already landed.
    logger.warn("Job alert email delivery failed", {
      searchId: search.id,
      err,
    });
  }
}

/**
 * Postings this search has already alerted on. The watermark alone is not
 * enough: a posting can be edited or re-published after the window moved.
 */
async function notifiedPostingIds(
  layer: DataLayer,
  userId: string,
  savedSearchId: string,
): Promise<Set<string>> {
  const { data } = await layer
    .getClient()
    .from("notifications")
    .select("data")
    .eq("user_id", userId)
    .eq("type", JOB_ALERT_NOTIFICATION_TYPE)
    .order("date", { ascending: false })
    .limit(200);

  const ids = new Set<string>();
  for (const row of data || []) {
    const payload = (row.data ?? null) as Record<string, unknown> | null;
    if (!payload || payload.savedSearchId !== savedSearchId) continue;
    if (typeof payload.postingId === "string") ids.add(payload.postingId);
  }
  return ids;
}
