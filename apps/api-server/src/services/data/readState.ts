/**
 * data/readState.ts — unread counts, the mark-as-read writes, DM thread state
 * and `chat_mutes`. Everything that decides what a badge says.
 *
 * ## Purpose
 *
 * Extracted verbatim from `services/supabase.ts` (monolith lane M1d, step 13):
 * the whole UNREAD COUNTS, READ STATE, DM THREAD STATE AND MUTES section,
 * 16 methods. First module of the chat cluster, and deliberately the leaf of
 * it: `directMessages.ts`, `boardActions.ts` and the send path all read the
 * state this module writes, never the other way round.
 *
 * ## What it touches
 *
 * Tables: `group_members`, `messages`, `dm_threads`, `dm_messages`,
 * `dm_read_status`, `chat_mutes`. RPCs: `get_unread_counts_batch`,
 * `get_dm_unread_counts_batch`. No storage buckets.
 *
 * ## The gotchas
 *
 * 1. THE BATCHED COUNTERS DEGRADE, THEY DO NOT FAIL. Both
 *    `getAllGroupUnreadCounts` and `getAllDMUnreadCounts` prefer an RPC and,
 *    when it errors, fall back to per-thread queries — but only OUTSIDE
 *    production, where `NODE_ENV === "production"` returns `{}` instead so a
 *    missing RPC cannot turn one request into N. The badge is then
 *    absent-but-cheap in prod and wrong-but-present in dev. Both are
 *    deliberate; neither throws.
 *
 * 2. DELETE IS A CUTOFF, NOT A DELETE. `deleteDmThread` is delete-for-me: it
 *    appends the caller to `hidden_by` and stamps a per-user
 *    `history_cleared_at`, then anchors `dm_read_status.last_read_at` at the
 *    same instant so the unread math cannot revive rows the cutoff hides. The
 *    other participant keeps their full history and the marketplace inquiry
 *    FKs survive. Every DM read elsewhere must honour that cutoff
 *    (`readDmHistoryClearedAt` / `effectiveDmUnreadFloor`), which is why the
 *    floor is computed here rather than assumed.
 *
 * 3. MUTES ARE ACCESS-CONTROLLED, READS ARE NOT. `setChatMute` and
 *    `clearChatMute` both go through `assertChatMuteAccess` first: the service
 *    role bypasses RLS, so that predicate IS the rule that you may only mute a
 *    scope you can actually see. `isChatMuted` / `getChatMute` are unguarded
 *    on purpose — they are keyed by the caller's own `user_id` and read only
 *    their own row. `getChatMute` additionally fire-and-forgets a delete of an
 *    expired row; it is opportunistic cleanup, so its failure is ignored.
 *
 * 4. This section logs with `console.error`, not `logger.error`, everywhere
 *    except the two mute writes. That inconsistency moved with the code —
 *    `supabase.tableInventory.test.ts` and the surface freeze care about the
 *    queries, not the logger, and normalising it here would be a behaviour
 *    change in a refactor PR.
 *
 * ## Why the cross-method calls go back through `deps`
 *
 * Seven call sites reach a sibling: the two batched counters call their
 * fallback, the DM fallback calls `getDMUnreadCount`, both mark-as-read writes
 * call `broadcastChatRead` (still in the monolith's CHAT INTERNALS section),
 * and both mute writes call `assertChatMuteAccess`. None are wired as local
 * calls. On `SupabaseService` these are prototype methods, so a suite can
 * `jest.spyOn` any of them — a local call would step around the spy and change
 * behaviour under test. *
 * `deps` is built ONCE per domain in `data/index.ts`, as arrows that read
 * through the layer at CALL time. (It used to be built INLINE by the
 * `SupabaseService` facade, as arrows over `this`; the facade is deleted —
 * monolith lane M3 — and the property that matters, late binding, is the
 * same.)
 */
import { logger } from "../../utils/logger";
import {
  effectiveDmUnreadFloor,
  readDmHistoryClearedAt,
  withDmHistoryClearedAt,
} from "@lantern/shared/utils/dmHistoryCutoff";

import { cacheService } from "../cache";

import type { DataClient } from "./client";

/**
 * Everything a moved body used to reach through `this`.
 *
 * Build this literal INLINE at each delegating call site, with arrows that
 * read `this.<method>` at CALL time. Hoisting it to an instance field compiles
 * and passes the surface freeze, but breaks every suite that invokes these
 * methods on a bare `{ supabase }` stand-in that never ran a constructor, and
 * bypasses every `jest.spyOn` on the class.
 */
export type ReadStateDeps = {
  getAllGroupUnreadCountsFallback: (
    userId: string,
  ) => Promise<Record<string, number>>;
  getAllDMUnreadCountsFallback: (
    userId: string,
  ) => Promise<Record<string, number>>;
  getDMUnreadCount: (threadId: string, userId: string) => Promise<number>;
  assertChatMuteAccess: (
    userId: string,
    scopeType: "group" | "dm",
    scopeId: string,
  ) => Promise<boolean>;
  /** Chat internals, still in the monolith (lane M1d step 17 moves it). */
  broadcastChatRead: (
    chatId: string,
    payload: { userId: string; lastReadAt: string },
  ) => Promise<void>;
};

// Get unread message count for a group for a specific user
export async function getGroupUnreadCount(
  supabase: DataClient,
  groupId: string,
  userId: string,
): Promise<number> {
  try {
    // Get user's last read timestamp for this group
    const { data: memberData, error: memberError } = await supabase
      .from("group_members")
      .select("last_read_at")
      .eq("group_id", groupId)
      .eq("user_id", userId)
      .single();

    if (memberError) {
      console.error("Error getting last_read_at:", memberError);
      return 0;
    }

    const lastReadAt = memberData?.last_read_at || new Date(0).toISOString();

    // Count messages after last read that were not sent by the user
    const { count, error: countError } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("group_id", groupId)
      .neq("sender_id", userId)
      .is("removed_at", null)
      .eq("is_archived", false)
      .gt("timestamp", lastReadAt);

    if (countError) {
      console.error("Error counting unread messages:", countError);
      return 0;
    }

    return count || 0;
  } catch (error) {
    console.error("Error in getGroupUnreadCount:", error);
    return 0;
  }
}

// Get unread counts for all groups a user is in - OPTIMIZED: single query instead of N+1
export async function getAllGroupUnreadCounts(
  supabase: DataClient,
  deps: Pick<ReadStateDeps, "getAllGroupUnreadCountsFallback">,
  userId: string,
): Promise<Record<string, number>> {
  try {
    // Use batch RPC function for single-query performance
    const { data, error } = await supabase.rpc("get_unread_counts_batch", {
      p_user_id: userId,
    });

    if (error) {
      console.error("Error in batch unread counts:", error);
      if (process.env.NODE_ENV === "production") {
        return {};
      }
      return await deps.getAllGroupUnreadCountsFallback(userId);
    }

    // Convert array result to Record
    const unreadCounts: Record<string, number> = {};
    if (data && Array.isArray(data)) {
      for (const item of data) {
        unreadCounts[item.group_id] = item.unread_count || 0;
      }
    }

    return unreadCounts;
  } catch (error) {
    console.error("Error in getAllGroupUnreadCounts:", error);
    return {};
  }
}

// Fallback method for environments without the batch function
/** @internal — no caller outside `getAllGroupUnreadCounts`. */
export async function getAllGroupUnreadCountsFallback(
  supabase: DataClient,
  userId: string,
): Promise<Record<string, number>> {
  try {
    // Get all groups the user is a member of with their last_read_at
    const { data: memberships, error: memberError } = await supabase
      .from("group_members")
      .select("group_id, last_read_at")
      .eq("user_id", userId);

    if (memberError || !memberships) {
      console.error("Error getting memberships:", memberError);
      return {};
    }

    const unreadCounts: Record<string, number> = {};

    // For each group, count unread messages
    for (const membership of memberships) {
      const lastReadAt = membership.last_read_at || new Date(0).toISOString();

      const { count, error: countError } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("group_id", membership.group_id)
        .neq("sender_id", userId)
        .is("removed_at", null)
        .eq("is_archived", false)
        .gt("timestamp", lastReadAt);

      if (!countError) {
        unreadCounts[membership.group_id] = count || 0;
      }
    }

    return unreadCounts;
  } catch (error) {
    console.error("Error in getAllGroupUnreadCountsFallback:", error);
    return {};
  }
}

// Mark group as read for a user
export async function markGroupAsRead(
  supabase: DataClient,
  deps: Pick<ReadStateDeps, "broadcastChatRead">,
  groupId: string,
  userId: string,
): Promise<{ success: boolean; previousLastReadAt: string | null }> {
  try {
    // Capture the prior marker before overwriting so clients can scroll to first unread.
    const { data: membership, error: readError } = await supabase
      .from("group_members")
      .select("last_read_at, joined_at")
      .eq("group_id", groupId)
      .eq("user_id", userId)
      .maybeSingle();

    if (readError) {
      console.error(
        "Error reading group membership for mark-as-read:",
        readError,
      );
      return { success: false, previousLastReadAt: null };
    }

    const previousLastReadAt: string | null =
      membership?.last_read_at || membership?.joined_at || null;

    const { error } = await supabase
      .from("group_members")
      .update({ last_read_at: new Date().toISOString() })
      .eq("group_id", groupId)
      .eq("user_id", userId);

    if (error) {
      console.error("Error marking group as read:", error);
      return { success: false, previousLastReadAt };
    }

    // Invalidate cache
    cacheService.delete(`group:unread:${groupId}:${userId}`);
    cacheService.delete(`user:unread:${userId}`);

    const lastReadAt = new Date().toISOString();
    void deps.broadcastChatRead(groupId, { userId, lastReadAt });

    return { success: true, previousLastReadAt };
  } catch (error) {
    console.error("Error in markGroupAsRead:", error);
    return { success: false, previousLastReadAt: null };
  }
}

// Get unread DM count for a thread for a specific user
export async function getDMUnreadCount(
  supabase: DataClient,
  threadId: string,
  userId: string,
): Promise<number> {
  try {
    // Get user's last read timestamp for this thread
    const [{ data: readStatus }, { data: threadMeta }] = await Promise.all([
      supabase
        .from("dm_read_status")
        .select("last_read_at")
        .eq("thread_id", threadId)
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("dm_threads")
        .select("history_cleared_at")
        .eq("id", threadId)
        .maybeSingle(),
    ]);

    // If no read status exists, count all messages not from this user
    const lastReadAt = readStatus?.last_read_at || new Date(0).toISOString();
    const historyClearedAt = readDmHistoryClearedAt(
      threadMeta?.history_cleared_at,
      userId,
    );
    const unreadFloor = effectiveDmUnreadFloor(lastReadAt, historyClearedAt);

    // Count messages after last read (and after delete cutoff) not sent by the user
    const { count, error: countError } = await supabase
      .from("dm_messages")
      .select("id", { count: "exact", head: true })
      .eq("thread_id", threadId)
      .neq("sender_id", userId)
      .is("removed_at", null)
      .gt("timestamp", unreadFloor);

    if (countError) {
      console.error("Error counting unread DMs:", countError);
      return 0;
    }

    return count || 0;
  } catch (error) {
    console.error("Error in getDMUnreadCount:", error);
    return 0;
  }
}

// Get all DM unread counts for a user - OPTIMIZED: single query instead of N+1
export async function getAllDMUnreadCounts(
  supabase: DataClient,
  deps: Pick<ReadStateDeps, "getAllDMUnreadCountsFallback">,
  userId: string,
): Promise<Record<string, number>> {
  try {
    // Use batch RPC function for single-query performance
    const { data, error } = await supabase.rpc("get_dm_unread_counts_batch", {
      p_user_id: userId,
    });

    if (error) {
      console.error("Error in batch DM unread counts:", error);
      if (process.env.NODE_ENV === "production") {
        return {};
      }
      return await deps.getAllDMUnreadCountsFallback(userId);
    }

    // Convert array result to Record of unread counts
    const unreadCounts: Record<string, number> = {};
    if (data && Array.isArray(data)) {
      for (const item of data) {
        // Calculate unread based on last_read_at vs messages
        unreadCounts[item.thread_id] = item.unread_count || 0;
      }
    }

    return unreadCounts;
  } catch (error) {
    console.error("Error in getAllDMUnreadCounts:", error);
    return {};
  }
}

// Fallback method for environments without the batch function
/** @internal — no caller outside `getAllDMUnreadCounts`. */
export async function getAllDMUnreadCountsFallback(
  supabase: DataClient,
  deps: Pick<ReadStateDeps, "getDMUnreadCount">,
  userId: string,
): Promise<Record<string, number>> {
  try {
    // Get all DM threads the user is part of
    const { data: threads, error: threadError } = await supabase
      .from("dm_threads")
      .select("id, participant_ids");

    if (threadError || !threads) {
      console.error("Error getting DM threads:", threadError);
      return {};
    }

    // Filter to threads that include this user
    const userThreads = threads.filter((t: any) => {
      const participantIds = t.participant_ids;
      return Array.isArray(participantIds) && participantIds.includes(userId);
    });

    const unreadCounts: Record<string, number> = {};

    for (const thread of userThreads) {
      const count = await deps.getDMUnreadCount(thread.id, userId);
      unreadCounts[thread.id] = count;
    }

    return unreadCounts;
  } catch (error) {
    console.error("Error in getAllDMUnreadCountsFallback:", error);
    return {};
  }
}

// Mark DM thread as read for a user; returns previous last_read_at for unread anchoring.
export async function markDMAsRead(
  supabase: DataClient,
  deps: Pick<ReadStateDeps, "broadcastChatRead">,
  threadId: string,
  userId: string,
): Promise<{ success: boolean; previousLastReadAt: string | null }> {
  try {
    // Only participants may write read status for a thread.
    const { data: thread, error: threadError } = await supabase
      .from("dm_threads")
      .select("participant_ids")
      .eq("id", threadId)
      .single();

    const participantIds = Array.isArray(thread?.participant_ids)
      ? thread.participant_ids
      : [];
    if (threadError || !participantIds.includes(userId)) {
      console.error("markDMAsRead: user is not a participant of this thread");
      return { success: false, previousLastReadAt: null };
    }

    const { data: prior } = await supabase
      .from("dm_read_status")
      .select("last_read_at")
      .eq("thread_id", threadId)
      .eq("user_id", userId)
      .maybeSingle();
    const previousLastReadAt = prior?.last_read_at || null;

    const lastReadAt = new Date().toISOString();
    const { error } = await supabase.from("dm_read_status").upsert(
      {
        thread_id: threadId,
        user_id: userId,
        last_read_at: lastReadAt,
      },
      { onConflict: "thread_id,user_id" },
    );

    if (error) {
      console.error("Error marking DM as read:", error);
      return { success: false, previousLastReadAt };
    }

    void deps.broadcastChatRead(threadId, { userId, lastReadAt });

    return { success: true, previousLastReadAt };
  } catch (error) {
    console.error("Error in markDMAsRead:", error);
    return { success: false, previousLastReadAt: null };
  }
}

// "Delete for me": hide from inbox (hidden_by) and set a history cutoff so
// pre-delete messages never resurface for this user. The other participant
// keeps their full history; marketplace inquiry FKs are preserved.
// A new message clears hidden_by (thread resurrects) but keeps history_cleared_at.
export async function deleteDmThread(
  supabase: DataClient,
  threadId: string,
  userId: string,
): Promise<boolean> {
  try {
    // Verify the user is a participant of this thread
    const { data: thread, error: fetchError } = await supabase
      .from("dm_threads")
      .select("participant_ids, hidden_by, history_cleared_at")
      .eq("id", threadId)
      .single();

    if (fetchError || !thread) {
      console.error("DM thread not found:", fetchError);
      return false;
    }

    const participantIds = Array.isArray(thread.participant_ids)
      ? thread.participant_ids
      : [];
    if (!participantIds.includes(userId)) {
      console.error("User is not a participant of this DM thread");
      return false;
    }

    const hiddenBy: string[] = Array.isArray(thread.hidden_by)
      ? thread.hidden_by
      : [];
    const clearedAt = new Date().toISOString();
    const nextHiddenBy = hiddenBy.includes(userId)
      ? hiddenBy
      : [...hiddenBy, userId];
    const nextHistoryClearedAt = withDmHistoryClearedAt(
      thread.history_cleared_at,
      userId,
      clearedAt,
    );

    const { error: updateError } = await supabase
      .from("dm_threads")
      .update({
        hidden_by: nextHiddenBy,
        history_cleared_at: nextHistoryClearedAt,
      })
      .eq("id", threadId);

    if (updateError) {
      console.error("Error hiding DM thread:", updateError);
      return false;
    }

    // Anchor read cursor at delete time so unread math cannot revive old rows
    // before history_cleared_at is applied everywhere.
    await supabase.from("dm_read_status").upsert(
      {
        thread_id: threadId,
        user_id: userId,
        last_read_at: clearedAt,
      },
      { onConflict: "thread_id,user_id" },
    );

    return true;
  } catch (error) {
    console.error("Error in deleteDmThread:", error);
    return false;
  }
}

// Archive a DM thread for a specific user
export async function archiveDmThread(
  supabase: DataClient,
  threadId: string,
  userId: string,
): Promise<boolean> {
  try {
    const { data: thread, error: fetchError } = await supabase
      .from("dm_threads")
      .select("participant_ids, archived_by")
      .eq("id", threadId)
      .single();

    if (fetchError || !thread) {
      console.error("DM thread not found:", fetchError);
      return false;
    }

    const participantIds = Array.isArray(thread.participant_ids)
      ? thread.participant_ids
      : [];
    if (!participantIds.includes(userId)) {
      console.error("User is not a participant of this DM thread");
      return false;
    }

    const archivedBy = Array.isArray(thread.archived_by)
      ? thread.archived_by
      : [];
    if (archivedBy.includes(userId)) return true; // Already archived

    const { error } = await supabase
      .from("dm_threads")
      .update({ archived_by: [...archivedBy, userId] })
      .eq("id", threadId);

    if (error) {
      console.error("Error archiving DM thread:", error);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Error in archiveDmThread:", error);
    return false;
  }
}

// Unarchive a DM thread for a specific user
export async function unarchiveDmThread(
  supabase: DataClient,
  threadId: string,
  userId: string,
): Promise<boolean> {
  try {
    const { data: thread, error: fetchError } = await supabase
      .from("dm_threads")
      .select("archived_by")
      .eq("id", threadId)
      .single();

    if (fetchError || !thread) {
      console.error("DM thread not found:", fetchError);
      return false;
    }

    const archivedBy = Array.isArray(thread.archived_by)
      ? thread.archived_by
      : [];
    const { error } = await supabase
      .from("dm_threads")
      .update({
        archived_by: archivedBy.filter((id: string) => id !== userId),
      })
      .eq("id", threadId);

    if (error) {
      console.error("Error unarchiving DM thread:", error);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Error in unarchiveDmThread:", error);
    return false;
  }
}

export async function isChatMuted(
  supabase: DataClient,
  userId: string,
  scopeType: "group" | "dm",
  scopeId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("chat_mutes")
    .select("muted_until")
    .eq("user_id", userId)
    .eq("scope_type", scopeType)
    .eq("scope_id", scopeId)
    .maybeSingle();
  if (error || !data?.muted_until) return false;
  return new Date(data.muted_until).getTime() > Date.now();
}

export async function getChatMute(
  supabase: DataClient,
  userId: string,
  scopeType: "group" | "dm",
  scopeId: string,
): Promise<{ muted: boolean; mutedUntil: string | null }> {
  const { data, error } = await supabase
    .from("chat_mutes")
    .select("muted_until")
    .eq("user_id", userId)
    .eq("scope_type", scopeType)
    .eq("scope_id", scopeId)
    .maybeSingle();
  if (error || !data?.muted_until) {
    return { muted: false, mutedUntil: null };
  }
  const mutedUntil = data.muted_until as string;
  const muted = new Date(mutedUntil).getTime() > Date.now();
  if (!muted) {
    // Opportunistically clean expired rows.
    void supabase
      .from("chat_mutes")
      .delete()
      .eq("user_id", userId)
      .eq("scope_type", scopeType)
      .eq("scope_id", scopeId);
    return { muted: false, mutedUntil: null };
  }
  return { muted: true, mutedUntil };
}

/** @internal — the mute-write predicate; no caller outside this module. */
export async function assertChatMuteAccess(
  supabase: DataClient,
  userId: string,
  scopeType: "group" | "dm",
  scopeId: string,
): Promise<boolean> {
  if (scopeType === "group") {
    const { data, error } = await supabase
      .from("group_members")
      .select("user_id")
      .eq("group_id", scopeId)
      .eq("user_id", userId)
      .eq("pending", false)
      .maybeSingle();
    return !error && !!data;
  }
  const { data, error } = await supabase
    .from("dm_threads")
    .select("participant_ids")
    .eq("id", scopeId)
    .maybeSingle();
  if (error || !data) return false;
  const pids = Array.isArray(data.participant_ids) ? data.participant_ids : [];
  return pids.includes(userId);
}

export async function setChatMute(
  supabase: DataClient,
  deps: Pick<ReadStateDeps, "assertChatMuteAccess">,
  userId: string,
  scopeType: "group" | "dm",
  scopeId: string,
  mutedUntil: Date,
): Promise<{ muted: boolean; mutedUntil: string } | null> {
  const allowed = await deps.assertChatMuteAccess(userId, scopeType, scopeId);
  if (!allowed) return null;
  if (
    !(mutedUntil instanceof Date) ||
    Number.isNaN(mutedUntil.getTime()) ||
    mutedUntil.getTime() <= Date.now()
  ) {
    return null;
  }
  const untilIso = mutedUntil.toISOString();
  const { data, error } = await supabase
    .from("chat_mutes")
    .upsert(
      {
        user_id: userId,
        scope_type: scopeType,
        scope_id: scopeId,
        muted_until: untilIso,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,scope_type,scope_id" },
    )
    .select("muted_until")
    .single();
  if (error || !data) {
    logger.error("Failed to set chat mute", {
      error,
      userId,
      scopeType,
      scopeId,
    });
    return null;
  }
  return { muted: true, mutedUntil: data.muted_until as string };
}

export async function clearChatMute(
  supabase: DataClient,
  deps: Pick<ReadStateDeps, "assertChatMuteAccess">,
  userId: string,
  scopeType: "group" | "dm",
  scopeId: string,
): Promise<boolean> {
  const allowed = await deps.assertChatMuteAccess(userId, scopeType, scopeId);
  if (!allowed) return false;
  const { error } = await supabase
    .from("chat_mutes")
    .delete()
    .eq("user_id", userId)
    .eq("scope_type", scopeType)
    .eq("scope_id", scopeId);
  if (error) {
    logger.error("Failed to clear chat mute", {
      error,
      userId,
      scopeType,
      scopeId,
    });
    return false;
  }
  return true;
}
