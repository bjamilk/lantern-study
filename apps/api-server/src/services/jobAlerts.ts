/**
 * Job alerts: turns newly published postings into notifications for the saved
 * searches they match. Runs on the same cadence as marketplace alerts.
 */
import {
  JOB_SAVED_SEARCH_MAX_MATCHES_PER_RUN,
  jobPostingMatchesSearch,
  normalizeJobSearchFilters,
} from "@lantern/shared/jobs";
import type { SupabaseService } from "./supabase";
import { logger } from "../utils/logger";

export const JOB_ALERT_NOTIFICATION_TYPE = "job_alert";

/** Rows scanned per search. A backlog larger than this is not worth replaying. */
const POSTING_SCAN_LIMIT = 50;

export async function processJobSavedSearchAlerts(
  supabaseService: SupabaseService,
): Promise<number> {
  const db = supabaseService.getClient();
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
        "id, title, description, employment_type, is_remote, campus_id, company_id, compensation, created_at",
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
        supabaseService,
        search.user_id,
        search.id,
      );
      for (const posting of matches) {
        if (alreadyNotified.has(posting.id)) continue;
        const notification = await supabaseService.createNotification(
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
    }

    // Advance the watermark even with no matches, so the next run scans a
    // smaller window instead of re-reading the same rows forever.
    await db
      .from("job_saved_searches")
      .update({ last_checked_at: now })
      .eq("id", search.id);
  }

  if (sent > 0) {
    logger.info("Job saved search alerts sent", { count: sent });
  }
  return sent;
}

/**
 * Postings this search has already alerted on. The watermark alone is not
 * enough: a posting can be edited or re-published after the window moved.
 */
async function notifiedPostingIds(
  supabaseService: SupabaseService,
  userId: string,
  savedSearchId: string,
): Promise<Set<string>> {
  const { data } = await supabaseService
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
