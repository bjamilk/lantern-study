/**
 * data/messageSearch.ts — full-history search across group chats and DMs.
 *
 * ## Purpose
 *
 * Extracted verbatim from `routes/messages.ts` (monolith lane R2, PR 2b), where
 * one `const client` spanned six chains inside a single handler. The route keeps
 * every decision: the two-character minimum, the wildcard sanitiser, the 30-row
 * cap, which scope the caller asked for, and how a hit is rendered.
 *
 * ## What it touches
 *
 * Tables: `group_members`, `dm_threads`, `messages`, `dm_messages`, `groups`.
 * Reads only. No storage buckets, no RPCs.
 *
 * ## The gotcha: SEARCH IS AN AUTHORIZATION PROBLEM
 *
 * The API holds the service-role client, which BYPASSES RLS. A text search over
 * `messages` and `dm_messages` with no scope therefore returns every private
 * conversation on the platform. What prevents that is the ORDER these functions
 * are called in, and nothing else:
 *
 *   1. `resolveSearchableGroupIds` / `resolveSearchableThreads` — which groups
 *      this caller belongs to, which threads they participate in;
 *   2. only then `searchGroupMessages` / `searchDirectMessages`, restricted with
 *      `in(…)` to those id lists.
 *
 * So step 2's functions take an ID LIST, never a free scope, and every function
 * in step 1 takes `userId` as a REQUIRED parameter and applies the predicate
 * itself. A caller that passes ids it has not resolved for that user has
 * defeated the whole model; there is no second line of defence behind this.
 *
 * Two more that look incidental:
 *
 *   - `contains("participant_ids", JSON.stringify([userId]))` passes a JSON
 *     STRING. PostgREST renders a JS array as Postgres `{uuid}` and the query
 *     fails with 22P02, so the string form is load-bearing.
 *   - `is("removed_at", null)` on both message stores. Without it a deleted
 *     message is still recoverable through search.
 */
import type { DataClient } from "./client";

/** The caller's membership in ONE group, or none. The "may I search here" check. */
export async function getSearchScopeMembership(
  supabase: DataClient,
  groupId: string,
  userId: string,
): Promise<{ data: { group_id: string } | null; error: any }> {
  return await supabase
    .from("group_members")
    .select("group_id")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();
}

/** Every group the caller belongs to, capped at 300. */
export async function listSearchableGroupIds(
  supabase: DataClient,
  userId: string,
): Promise<{ data: Array<{ group_id: string }> | null; error: any }> {
  return await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", userId)
    .limit(300);
}

/**
 * The DM threads the caller participates in, capped at 300, optionally narrowed
 * to one thread. `hidden_by` comes back so the caller can drop threads this user
 * has hidden — that filtering stays in the route, which owns the rule.
 */
export async function listSearchableThreads(
  supabase: DataClient,
  userId: string,
  scopeThreadId: string | null,
): Promise<{ data: any[] | null; error: any }> {
  let query = supabase
    .from("dm_threads")
    .select("id, participant_ids, participants, hidden_by")
    // A JSON string, not a JS array — see the gotcha.
    .contains("participant_ids", JSON.stringify([userId]));
  if (scopeThreadId) query = query.eq("id", scopeThreadId);
  return await query.limit(300);
}

/**
 * Search group messages, restricted to `groupIds` the caller has been RESOLVED
 * to belong to. `pattern` is the caller's sanitised `%…%` term.
 */
export async function searchGroupMessages(
  supabase: DataClient,
  groupIds: string[],
  pattern: string,
  limit: number,
): Promise<{ data: any[] | null; error: any }> {
  return await supabase
    .from("messages")
    .select("id, group_id, sender_id, text, question_stem, timestamp")
    .in("group_id", groupIds)
    .is("removed_at", null)
    .or(`text.ilike.${pattern},question_stem.ilike.${pattern}`)
    .order("timestamp", { ascending: false })
    .limit(limit);
}

/**
 * Search direct messages, restricted to `threadIds` the caller has been RESOLVED
 * to participate in.
 */
export async function searchDirectMessages(
  supabase: DataClient,
  threadIds: string[],
  pattern: string,
  limit: number,
): Promise<{ data: any[] | null; error: any }> {
  return await supabase
    .from("dm_messages")
    .select("id, thread_id, sender_id, text, timestamp")
    .in("thread_id", threadIds)
    .is("removed_at", null)
    // A plain `ilike`, not the `or(…)` its group-chat sibling needs: a DM has no
    // `question_stem` column to search alongside the text.
    .ilike("text", pattern)
    .order("timestamp", { ascending: false })
    .limit(limit);
}

/**
 * Names and avatars for the groups a search actually matched — labels only, so
 * this takes the ids the search already returned rather than a user scope.
 */
export async function listGroupLabels(
  supabase: DataClient,
  groupIds: string[],
): Promise<{ data: Array<{ id: string; name: string; avatar_url: string | null }> | null; error: any }> {
  return await supabase
    .from("groups")
    .select("id, name, avatar_url")
    .in("id", groupIds);
}
