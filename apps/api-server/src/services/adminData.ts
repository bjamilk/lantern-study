/**
 * Every database read and write the admin console performs.
 *
 * Why this module exists (M4). `routes/admin.ts` was a route file that WAS the
 * data layer: 57 direct `.from()` calls across 18 tables, 27 `getClient()`
 * escape-hatch calls, six GoTrue admin calls and one RPC, inlined among the
 * handlers. That is the worst layering violation in the API server, and with a
 * 0.06 test-to-source ratio on that file it was also the least covered. Lifting
 * the queries here gives them a name, a single place to change, and — through
 * `adminData.queryShape.test.ts` — a test that pins the table, the filters and
 * the columns of each one.
 *
 * Shape of this module, and why it is not a class. Every function takes the
 * `SupabaseService` as its first argument and asks it for the client. There is
 * no state to hold (the measurement behind the M-programme found the same for
 * `SupabaseService` itself: no two of its methods share a field), so a class
 * would be a namespace wearing a costume.
 *
 * It uses ONLY `SupabaseService.getClient()`, a method that already exists —
 * lane M1 owns that file, and nothing here adds to it.
 *
 * Error convention. These functions return PostgREST's own `{data, error}` (or
 * the plain value, where the caller ignored the error before) rather than
 * throwing. That is deliberate: the routes decide what a failure means, and
 * several of them branch on the error — `GET /audit` degrades to
 * `tableReady: false` on a 42P01, `GET /users` falls back to a page scan when
 * the email RPC is not deployed. Swallowing or re-typing errors here would
 * delete those branches. The one exception is `setAuthBan`, which has always
 * been best-effort and says so.
 *
 * What it touches: `profiles`, `platform_admins`, `admin_audit_log`,
 * `content_reports`, `marketplace_listings`, `marketplace_reports`,
 * `marketplace_orders`, `groups`, `group_members`, `messages`, `decks`,
 * `flashcards`, `offline_bundles`, `ai_analytics`, `ai_inference_log`,
 * `ai_companion_messages`, `product_events`, `study_activity`; the GoTrue admin
 * API (`getUserById`, `updateUserById`, `signOut`, `listUsers`) and the
 * `admin_search_users_by_email` RPC.
 *
 * Gotcha: `head: true` with `count: 'exact'` returns a row-less count. Several
 * functions here return the whole PostgREST result for that reason — the count
 * is on the result, not in `data`.
 */
import type { DataLayer } from './data';
import { logger } from '../utils/logger';

/** The client, as `any`: the admin surface uses GoTrue admin calls and RPCs
 *  that the typed client does not expose. */
function db(layer: DataLayer): any {
  return layer.getClient();
}

// ===========================================================================
// Column sets
//
// Named because the same projection is used by more than one query and a
// silent divergence between them would change what the console renders.
// ===========================================================================

/** The user row the console's user list and search results render. */
export const ADMIN_USER_COLUMNS =
  'id, name, username, first_name, last_name, avatar_url, points, settings, created_at';

/** The user row the single-user drawer renders (adds badges and stats). */
export const ADMIN_USER_DETAIL_COLUMNS =
  'id, name, username, first_name, last_name, avatar_url, points, badges, settings, stats, created_at';

/** Just enough of a profile to label an actor or an owner. */
export const PROFILE_SUMMARY_COLUMNS = 'id, name, username';

// ===========================================================================
// GoTrue admin API
//
// The auth half of a user. `profiles` carries the display row; GoTrue carries
// the email, `app_metadata.is_platform_admin` and `banned_until`. Ban and role
// changes must write both, which is why they sit side by side here.
// ===========================================================================

/**
 * How long a ban lasts at the auth layer. GoTrue takes a duration string, not
 * an end date, and has no "forever" — ~100 years is the conventional stand-in.
 * A ban is lifted explicitly by setting 'none', never by expiry.
 */
export const AUTH_BAN_DURATION = '876000h';

/**
 * Ban or unban a user in GoTrue itself.
 *
 * Why this exists: banning only wrote profiles.settings and signed the user
 * out. Signing out invalidates the tokens they already hold — it does not stop
 * them signing straight back in for a fresh one. Setting banned_until makes
 * GoTrue refuse to issue tokens at all, which is what "banned" should mean.
 *
 * Never throws: the ban is already recorded in the database and enforced by
 * the API, so a GoTrue hiccup must not fail the admin's action or leave the
 * two halves inconsistent. Returns whether the auth layer agreed, so the
 * caller can surface it.
 *
 * Takes a raw client rather than the service because `adminAuthBan.test.ts`
 * drives it with a hand-built GoTrue double.
 */
export async function setAuthBan(
  client: any,
  userId: string,
  duration: typeof AUTH_BAN_DURATION | 'none'
): Promise<boolean> {
  try {
    const { error } = await client.auth.admin.updateUserById(userId, {
      ban_duration: duration,
    });
    if (error) {
      logger.warn('Auth-layer ban update failed', {
        userId,
        duration,
        error: error.message,
      });
      return false;
    }
    return true;
  } catch (err) {
    logger.warn('Auth-layer ban update threw', {
      userId,
      duration,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/** `setAuthBan` for callers that hold the service rather than the client. */
export function applyAuthBan(
  layer: DataLayer,
  userId: string,
  duration: typeof AUTH_BAN_DURATION | 'none'
): Promise<boolean> {
  return setAuthBan(db(layer), userId, duration);
}

/** The GoTrue user record: email, app_metadata, created_at. */
export function getAuthUser(layer: DataLayer, userId: string): Promise<any> {
  return db(layer).auth.admin.getUserById(userId);
}

/** Write GoTrue `app_metadata` (this is where `is_platform_admin` lives). */
export function setAuthUserMetadata(
  layer: DataLayer,
  userId: string,
  appMetadata: Record<string, unknown>
): Promise<any> {
  return db(layer).auth.admin.updateUserById(userId, { app_metadata: appMetadata });
}

/** Revoke every session the user holds. Throws — callers log and continue. */
export function signOutEverywhere(layer: DataLayer, userId: string): Promise<any> {
  return db(layer).auth.admin.signOut(userId, 'global');
}

/**
 * One page of GoTrue users. Only the legacy email-search fallback uses this:
 * the page scan stops at 1000 users, which is the bug the
 * `admin_search_users_by_email` RPC exists to fix.
 */
export function listAuthUsers(layer: DataLayer, page: number, perPage: number): Promise<any> {
  return db(layer).auth.admin.listUsers({ page, perPage });
}

/**
 * Match against `auth.users` directly (migration 20260817120000). Returns
 * `{data, error}` — `error` is how the caller detects that the migration has
 * not been applied and falls back to the page scan above.
 */
export function searchUsersByEmail(
  layer: DataLayer,
  searchQuery: string,
  resultLimit: number
): Promise<any> {
  return db(layer).rpc('admin_search_users_by_email', {
    search_query: searchQuery,
    result_limit: resultLimit,
  });
}

// ===========================================================================
// profiles
// ===========================================================================

/** One profile by id, in the list/search projection. Absent → data null. */
export function getUserForAdminList(layer: DataLayer, userId: string): Promise<any> {
  return db(layer).from('profiles').select(ADMIN_USER_COLUMNS).eq('id', userId).maybeSingle();
}

/** The list/search projection for a set of ids (email-search result hydration). */
export function getUsersForAdminList(layer: DataLayer, userIds: string[]): Promise<any> {
  return db(layer).from('profiles').select(ADMIN_USER_COLUMNS).in('id', userIds);
}

/**
 * One page of users, newest first, optionally name-filtered.
 *
 * `search` must already be escaped for a PostgREST `.or()` ilike filter —
 * `%`, `_` and `,` are special there. The route owns that escaping because it
 * also owns the UUID and email branches that never reach this query.
 */
export function listUsersPage(
  layer: DataLayer,
  opts: { escapedSearch?: string; offset: number; limit: number }
): Promise<any> {
  let query = db(layer)
    .from('profiles')
    .select(ADMIN_USER_COLUMNS, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(opts.offset, opts.offset + opts.limit - 1);

  if (opts.escapedSearch) {
    query = query.or(
      `name.ilike.%${opts.escapedSearch}%,username.ilike.%${opts.escapedSearch}%,first_name.ilike.%${opts.escapedSearch}%,last_name.ilike.%${opts.escapedSearch}%`
    );
  }
  return query;
}

/** The full profile the single-user drawer renders. */
export function getUserDetail(layer: DataLayer, userId: string): Promise<any> {
  return db(layer).from('profiles').select(ADMIN_USER_DETAIL_COLUMNS).eq('id', userId).maybeSingle();
}

/**
 * The settings blob only. `.single()`, not `.maybeSingle()`: both callers treat
 * a missing row as "User not found", and the status route checks `fetchErr`.
 */
export function getUserSettings(layer: DataLayer, userId: string): Promise<any> {
  return db(layer).from('profiles').select('settings').eq('id', userId).single();
}

/**
 * Replace the settings blob.
 *
 * This is the ONLY writer of `is_banned`, `account_status`,
 * `is_platform_admin`, `ban_reason`, `banned_at`, `banned_by`,
 * `suspended_until` and `moderation_flags` outside the service role:
 * `utils/sanitizeSettings.ts` strips all of them from user-supplied patches.
 * Callers pass the whole next blob, so they must merge onto the stored one.
 */
export function setUserSettings(
  layer: DataLayer,
  userId: string,
  settings: Record<string, unknown>
): Promise<any> {
  return db(layer).from('profiles').update({ settings }).eq('id', userId);
}

/** `id, name, username` for a set of ids — actor labels, owner labels. */
export function getProfileSummaries(layer: DataLayer, userIds: string[]): Promise<any> {
  return db(layer).from('profiles').select(PROFILE_SUMMARY_COLUMNS).in('id', userIds);
}

/** Newest sign-ups, for the activity feed. */
export function listRecentUsers(layer: DataLayer, limit: number): Promise<any> {
  return db(layer)
    .from('profiles')
    .select('id, name, username, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
}

// ===========================================================================
// platform_admins
//
// The table `isLivePlatformAdmin` actually reads. GoTrue `app_metadata` and
// `profiles.settings.is_platform_admin` are the other two places a grant is
// written; all three must stay in step, which is why the role route writes
// them together.
// ===========================================================================

export function grantPlatformAdmin(
  layer: DataLayer,
  userId: string,
  grantedBy: string
): Promise<any> {
  return db(layer)
    .from('platform_admins')
    .upsert({ user_id: userId, granted_by: grantedBy }, { onConflict: 'user_id' });
}

export function revokePlatformAdmin(layer: DataLayer, userId: string): Promise<any> {
  return db(layer).from('platform_admins').delete().eq('user_id', userId);
}

// ===========================================================================
// Dashboard counters
//
// One `Promise.all` of head-only `count: 'exact'` queries, so the console's
// landing page is a single round trip. Head-only means no rows cross the wire:
// the number is on the result, not in `data`.
// ===========================================================================

export type DashboardCounts = {
  userCount: number | null;
  listingCount: number | null;
  activeListingCount: number | null;
  reportCount: number | null;
  aiEventCount: number | null;
  newUsersToday: number | null;
  reportsResolved7d: number | null;
  aiEventsLast7d: number | null;
  groupCount: number | null;
  messageCount24h: number | null;
  deckCount: number | null;
  offlineBundleCount: number | null;
  openDisputeCount: number | null;
};

export async function getDashboardCounts(
  layer: DataLayer,
  window: { todayStart: string; last7d: string; last24h: string }
): Promise<DashboardCounts> {
  const client = db(layer);
  const { todayStart, last7d, last24h } = window;

  const [
    { count: userCount },
    { count: listingCount },
    { count: activeListingCount },
    { count: reportCount },
    { count: aiEventCount },
    { count: newUsersToday },
    { count: reportsResolved7d },
    { count: aiEventsLast7d },
    { count: groupCount },
    { count: messageCount24h },
    { count: deckCount },
    { count: offlineBundleCount },
    { count: openDisputeCount },
  ] = await Promise.all([
    client.from('profiles').select('id', { count: 'exact', head: true }),
    client.from('marketplace_listings').select('id', { count: 'exact', head: true }),
    client.from('marketplace_listings').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    client.from('marketplace_reports').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    client.from('ai_analytics').select('id', { count: 'exact', head: true }).gte('created_at', last24h),
    client.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
    client.from('marketplace_reports').select('id', { count: 'exact', head: true }).eq('status', 'resolved').gte('resolved_at', last7d),
    client.from('ai_analytics').select('id', { count: 'exact', head: true }).gte('created_at', last7d),
    client.from('groups').select('id', { count: 'exact', head: true }).eq('is_archived', false),
    client.from('messages').select('id', { count: 'exact', head: true }).gte('timestamp', last24h),
    client.from('decks').select('id', { count: 'exact', head: true }).is('removed_by_admin_at', null),
    client.from('offline_bundles').select('id', { count: 'exact', head: true }),
    client.from('marketplace_orders').select('id', { count: 'exact', head: true }).eq('status', 'disputed'),
  ]);

  return {
    userCount,
    listingCount,
    activeListingCount,
    reportCount,
    aiEventCount,
    newUsersToday,
    reportsResolved7d,
    aiEventsLast7d,
    groupCount,
    messageCount24h,
    deckCount,
    offlineBundleCount,
    openDisputeCount,
  };
}

/** Per-user counts for the single-user drawer. */
export async function getUserCounts(
  layer: DataLayer,
  userId: string,
  last7d: string
): Promise<{
  groupCount: number | null;
  listingCount: number | null;
  deckCount: number | null;
  aiEvents7d: number | null;
}> {
  const client = db(layer);
  const [
    { count: groupCount },
    { count: listingCount },
    { count: deckCount },
    { count: aiEvents7d },
  ] = await Promise.all([
    client.from('group_members').select('group_id', { count: 'exact', head: true }).eq('user_id', userId),
    client.from('marketplace_listings').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    client.from('decks').select('id', { count: 'exact', head: true }).eq('user_id', userId).is('removed_by_admin_at', null),
    client.from('ai_analytics').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', last7d),
  ]);
  return { groupCount, listingCount, deckCount, aiEvents7d };
}

/**
 * Distinct study_activity users since a date, capped at 10k rows — the same
 * definition the Analytics tab's WAU/DAU family uses.
 */
export function listRecentStudyActivityUsers(layer: DataLayer, sinceYmd: string): Promise<any> {
  return db(layer)
    .from('study_activity')
    .select('user_id')
    .gte('activity_date', sinceYmd)
    .gt('count', 0)
    .limit(10000);
}

// ===========================================================================
// marketplace_listings
// ===========================================================================

/** One page of listings for the moderation table, newest first. */
export function listListingsForAdmin(
  layer: DataLayer,
  opts: { status?: string; offset: number; limit: number }
): Promise<any> {
  let query = db(layer)
    .from('marketplace_listings')
    .select(
      'id, title, price, category, status, created_at, views_count, user_id, seller:profiles!marketplace_listings_user_id_fkey(id, name)',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range(opts.offset, opts.offset + opts.limit - 1);

  if (opts.status) query = query.eq('status', opts.status);
  return query;
}

/** Enough of a listing to decide a moderation action and notify its seller. */
export function getListingForModeration(layer: DataLayer, listingId: string): Promise<any> {
  return db(layer)
    .from('marketplace_listings')
    .select('id, status, user_id, title')
    .eq('id', listingId)
    .maybeSingle();
}

export function setListingStatus(
  layer: DataLayer,
  listingId: string,
  status: string
): Promise<any> {
  return db(layer).from('marketplace_listings').update({ status }).eq('id', listingId);
}

/**
 * Record why a listing was suspended, so the seller sees it and can appeal.
 * Returns the PostgREST thenable; the caller logs rather than throws, because
 * the status write above has already landed and must not be rolled back by a
 * failure to annotate it.
 */
export function setListingUnderReview(
  layer: DataLayer,
  listingId: string,
  fields: { reason: string; at: string; by: string }
): any {
  return db(layer)
    .from('marketplace_listings')
    .update({
      rights_status: 'under_review',
      takedown_reason: fields.reason,
      takedown_at: fields.at,
      takedown_by: fields.by,
    })
    .eq('id', listingId);
}

/** Newest listings, for the activity feed. */
export function listRecentListings(layer: DataLayer, limit: number): Promise<any> {
  return db(layer)
    .from('marketplace_listings')
    .select('id, title, created_at, user_id, status')
    .order('created_at', { ascending: false })
    .limit(limit);
}

// ===========================================================================
// marketplace_reports (legacy queue) and content_reports (generic queue)
// ===========================================================================

/** Newest marketplace reports, for the activity feed. */
export function listRecentMarketplaceReports(layer: DataLayer, limit: number): Promise<any> {
  return db(layer)
    .from('marketplace_reports')
    .select('id, reason, created_at, reporter_id')
    .order('created_at', { ascending: false })
    .limit(limit);
}

/** What a report points at — used to decide which caches a takedown clears. */
export function getReportTarget(layer: DataLayer, reportId: string): Promise<any> {
  return db(layer)
    .from('content_reports')
    .select('target_type, target_id')
    .eq('id', reportId)
    .maybeSingle();
}

/**
 * Mark a report reviewed with no automatic action on its target — the jobs
 * console's "resolved", as distinct from the generic "dismiss" action, which
 * goes through the moderation service. Returns `{data, error}` with the id, so
 * the caller can tell "no such report" (404) from a write failure (500).
 */
export function resolveReport(
  layer: DataLayer,
  reportId: string,
  fields: { note: string | null; resolvedBy: string; resolvedAt: string }
): Promise<any> {
  return db(layer)
    .from('content_reports')
    .update({
      status: 'resolved',
      admin_note: fields.note,
      resolved_by: fields.resolvedBy,
      resolved_at: fields.resolvedAt,
    })
    .eq('id', reportId)
    .select('id')
    .maybeSingle();
}

// ===========================================================================
// groups, messages, decks, flashcards, offline_bundles
// ===========================================================================

export function listGroupsForAdmin(
  layer: DataLayer,
  opts: { escapedSearch?: string; offset: number; limit: number }
): Promise<any> {
  let query = db(layer)
    .from('groups')
    .select('id, name, description, is_archived, created_at, last_message_time', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(opts.offset, opts.offset + opts.limit - 1);
  if (opts.escapedSearch) query = query.ilike('name', `%${opts.escapedSearch}%`);
  return query;
}

/** Soft removal: a group is archived, never deleted, so it can be restored. */
export function setGroupArchived(
  layer: DataLayer,
  groupId: string,
  isArchived: boolean
): Promise<any> {
  return db(layer).from('groups').update({ is_archived: isArchived }).eq('id', groupId);
}

export function listMessagesForAdmin(
  layer: DataLayer,
  opts: { groupId?: string; offset: number; limit: number }
): Promise<any> {
  let query = db(layer)
    .from('messages')
    .select(
      'id, group_id, sender_id, text, timestamp, type, sender:profiles!messages_sender_id_fkey(id, name, username)',
      { count: 'exact' }
    )
    .order('timestamp', { ascending: false })
    .range(opts.offset, opts.offset + opts.limit - 1);
  if (opts.groupId) query = query.eq('group_id', opts.groupId);
  return query;
}

/** The one hard delete in the console: a message leaves no tombstone. */
export function deleteMessage(layer: DataLayer, messageId: string): Promise<any> {
  return db(layer).from('messages').delete().eq('id', messageId);
}

export function listDecksForAdmin(
  layer: DataLayer,
  opts: { escapedSearch?: string; offset: number; limit: number }
): Promise<any> {
  let query = db(layer)
    .from('decks')
    .select(
      'id, name, description, user_id, created_at, removed_by_admin_at, owner:profiles!decks_user_id_fkey(id, name, username)',
      { count: 'exact' }
    )
    .is('removed_by_admin_at', null)
    .order('created_at', { ascending: false })
    .range(opts.offset, opts.offset + opts.limit - 1);
  if (opts.escapedSearch) query = query.ilike('name', `%${opts.escapedSearch}%`);
  return query;
}

/** Card ids only — the console counts them per deck rather than reading cards. */
export function listFlashcardDeckIds(layer: DataLayer, deckIds: string[]): Promise<any> {
  return db(layer).from('flashcards').select('deck_id').in('deck_id', deckIds);
}

/** Soft removal, so a student can appeal: the deck row survives. */
export function removeDeck(layer: DataLayer, deckId: string, removedAt: string): Promise<any> {
  return db(layer).from('decks').update({ removed_by_admin_at: removedAt }).eq('id', deckId);
}

/**
 * The 50 most recently updated offline bundles, with an exact total.
 * `count: 'exact'` so the console can say "showing 50 of N" — the hard cap used
 * to be invisible, indistinguishable from a complete list.
 */
export function listOfflineBundles(layer: DataLayer): Promise<any> {
  return db(layer)
    .from('offline_bundles')
    .select('id, user_id, display_name, group_name, updated_at, created_at', { count: 'exact' })
    .order('updated_at', { ascending: false })
    .limit(50);
}

// ===========================================================================
// AI analytics, inference log, product events, companion history
// ===========================================================================

/** Raw AI events since a timestamp, newest first. */
export function listAiEvents(layer: DataLayer, since: string, limit: number): Promise<any> {
  return db(layer)
    .from('ai_analytics')
    .select('event, created_at, user_id')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit);
}

/** AI events since a timestamp, for the per-user leaderboard. Unordered. */
export function listAiEventsByUser(layer: DataLayer, since: string, limit: number): Promise<any> {
  return db(layer)
    .from('ai_analytics')
    .select('user_id, event, created_at')
    .gte('created_at', since)
    .limit(limit);
}

/** Newest AI events, for the activity feed. */
export function listRecentAiEvents(layer: DataLayer, limit: number): Promise<any> {
  return db(layer)
    .from('ai_analytics')
    .select('id, event, created_at, user_id')
    .order('created_at', { ascending: false })
    .limit(limit);
}

/**
 * Token totals for the dashboard's cost figure.
 *
 * `token_estimate` is provider-reported prompt+completion for paid calls and
 * NULL for cache replays, so `.not('token_estimate', 'is', null)` is what makes
 * this genuine spend rather than phantom.
 */
export function listAiTokenEstimates(layer: DataLayer, since: string, limit: number): Promise<any> {
  return db(layer)
    .from('ai_inference_log')
    .select('token_estimate')
    .gte('created_at', since)
    .not('token_estimate', 'is', null)
    .limit(limit);
}

/** The per-feature, per-provider inference rows behind `GET /ai-tokens`. */
export function listAiInferenceRows(layer: DataLayer, since: string, limit: number): Promise<any> {
  return db(layer)
    .from('ai_inference_log')
    .select('feature, provider, token_estimate, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit);
}

/** The raw product-event stream behind `GET /events`. */
export function listProductEvents(layer: DataLayer, since: string, limit: number): Promise<any> {
  return db(layer)
    .from('product_events')
    .select('event, surface, user_id, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit);
}

/**
 * A named student's private AI companion conversation, newest first.
 * The most sensitive read in the console — its route audits BEFORE calling
 * this, so an admin who hits a 500 has still left a trail.
 */
export function listCompanionMessages(
  layer: DataLayer,
  userId: string,
  limit: number
): Promise<any> {
  return db(layer)
    .from('ai_companion_messages')
    .select('id, role, content, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
}

// ===========================================================================
// admin_audit_log
// ===========================================================================

/**
 * The audit trail, newest first. Returns `{data, error}`: the caller inspects
 * `error.code === '42P01'` to degrade to `tableReady: false` rather than
 * breaking the console on an environment where the migration has not run.
 */
export function listAuditEntries(layer: DataLayer, limit: number): Promise<any> {
  return db(layer)
    .from('admin_audit_log')
    .select('id, actor_id, action, target_type, target_id, metadata, reason, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
}
