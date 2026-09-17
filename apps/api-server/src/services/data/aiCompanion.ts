/**
 * data/aiCompanion.ts — the "Lantern" study companion's stored conversation.
 *
 * ## Purpose
 *
 * Extracted verbatim from `routes/aiCompanion.ts` (monolith lane R2, PR 2a).
 * Nine chains were built inline in the handlers, which is the layering violation
 * the lane closes. No module owned these tables, so this is a new domain.
 *
 * ## What it touches
 *
 * Tables: `ai_companion_messages`, `ai_companion_conversations`, `ai_analytics`.
 * No storage buckets, no RPCs.
 *
 * The CONVERSATION rows themselves — create, resolve-for-send, title, touch,
 * list, ownership check — belong to `services/companionConversations.ts`, which
 * already takes a client and is called by the route with one. Only the delete
 * moved here, because it was the one conversation query the route built itself.
 *
 * ## The gotchas
 *
 * 1. A COMPANION THREAD IS PRIVATE STUDY HISTORY, AND `userId` IS WHAT KEEPS IT
 *    THAT WAY. The API holds the SERVICE ROLE client, which BYPASSES RLS, so no
 *    policy will catch a missing predicate. Every function here takes `userId`
 *    as a REQUIRED parameter and applies it itself. There is deliberately NO
 *    function that reads or writes a conversation by its id alone: the two that
 *    take a `conversationId` filter on BOTH it and the owner, and so does the
 *    delete, even though the route has already checked ownership through
 *    `getOwnedConversation`. That belt and braces is the point, not redundancy
 *    to be tidied away.
 *
 * 2. `citations` MAY NOT EXIST YET (migration `20260912090000`). Both the
 *    history read and the message insert must survive a database without it:
 *    PostgREST answers `PGRST204` or `42703` naming the column, and the caller
 *    retries without it. That retry is a ROUTE decision and stays in the route —
 *    which is why `listConversationMessages` takes its column list as a
 *    parameter and the insert functions take the rows already built. Without the
 *    fallback a reloaded rail showed the answer as prose with "(Excerpt 1)" left
 *    in the sentence and no chip to tap, which is how it looked in production.
 *
 * 3. `recordAnalyticsEvent` returns `{ error }` that the caller currently drops.
 *    See the KNOWN ISSUE on it.
 *
 * ## Errors are returned, never swallowed
 *
 * Each function returns PostgREST's `{ data, error }` exactly as the inline code
 * consumed it, so the route keeps every branch it had: the citations retry, the
 * 404 on a feedback miss, the 500 that hides the database error from the client.
 */
import type { DataClient } from "./client";

// ============ MESSAGES ============

/**
 * One page of a thread, oldest first — what the rail renders on mount.
 * `columns` is a parameter so the caller can ask again without `citations` on a
 * database that has not had the migration applied (gotcha 2).
 */
export async function listConversationMessages(
  supabase: DataClient,
  userId: string,
  conversationId: string,
  columns: string,
): Promise<{ data: any[] | null; error: any }> {
  return await supabase
    .from("ai_companion_messages")
    .select(columns)
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(50);
}

/**
 * The last `limit` turns of a thread, NEWEST first — the caller reverses them
 * before handing them to the model. Both send paths (blocking and streaming)
 * read exactly this.
 */
export async function listRecentConversationMessages(
  supabase: DataClient,
  userId: string,
  conversationId: string,
  limit: number,
): Promise<{ data: any[] | null; error: any }> {
  return await supabase
    .from("ai_companion_messages")
    .select("role, content")
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);
}

/**
 * Persist one exchange. The caller builds the rows (it owns what a turn looks
 * like, including the `citations` it may have to strip) and this stamps the
 * owner on every one of them, so a row can never be written under another id.
 */
export async function insertConversationMessages(
  supabase: DataClient,
  userId: string,
  rows: ReadonlyArray<Record<string, unknown>>,
): Promise<{ error: any }> {
  const { error } = await supabase
    .from("ai_companion_messages")
    .insert(rows.map((row) => ({ ...row, user_id: userId })));
  return { error };
}

/** The same, returning the new ids the streaming path needs to cite. */
export async function insertConversationMessagesReturningIds(
  supabase: DataClient,
  userId: string,
  rows: ReadonlyArray<Record<string, unknown>>,
): Promise<{ data: Array<{ id: string; role: string }> | null; error: any }> {
  return await supabase
    .from("ai_companion_messages")
    .insert(rows.map((row) => ({ ...row, user_id: userId })))
    .select("id, role");
}

/**
 * Rate one ASSISTANT message the caller owns. The `role` filter is not
 * cosmetic: without it a student could rate their own turn, which is not a
 * signal about the model. Returns the id so a miss can answer 404.
 */
export async function setMessageFeedback(
  supabase: DataClient,
  userId: string,
  messageId: string,
  feedback: "up" | "down" | null,
): Promise<{ data: { id: string } | null; error: any }> {
  return await supabase
    .from("ai_companion_messages")
    .update({ feedback })
    .eq("id", messageId)
    .eq("user_id", userId)
    .eq("role", "assistant")
    .select("id")
    .maybeSingle();
}

// ============ CONVERSATIONS ============

/**
 * Delete one of the caller's conversations. Filters on the owner as well as the
 * id even though the route has already resolved ownership — see gotcha 1.
 */
export async function deleteConversation(
  supabase: DataClient,
  userId: string,
  conversationId: string,
): Promise<{ error: any }> {
  const { error } = await supabase
    .from("ai_companion_conversations")
    .delete()
    .eq("id", conversationId)
    .eq("user_id", userId);
  return { error };
}

// ============ ANALYTICS ============

/**
 * Record one companion UI event for the caller.
 *
 * KNOWN ISSUE (tracked, found during R2): the caller wraps this in try/catch and
 * logs "AI analytics insert failed (non-critical)", but PostgREST RESOLVES with
 * `{error}` rather than throwing, so that catch never runs and a failed insert
 * is reported to the client as `{success: true}`. The `{error}` is returned here
 * so a caller CAN check it; the route is left exactly as it was, because this
 * lane moves queries and does not fix them.
 */
export async function recordAnalyticsEvent(
  supabase: DataClient,
  userId: string,
  event: string,
  metadata: Record<string, unknown>,
  createdAt: string,
): Promise<{ error: any }> {
  const { error } = await supabase
    .from("ai_analytics")
    .insert({ user_id: userId, event, metadata, created_at: createdAt });
  return { error };
}
