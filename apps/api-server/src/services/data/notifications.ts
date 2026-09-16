/**
 * data/notifications.ts — `notifications` CRUD, the bulk fan-out and the
 * unread counters.
 *
 * ## Purpose
 *
 * Extracted verbatim from `services/supabase.ts` (monolith lane M1, step 3).
 * The largest of the four leaf sections, and the only one with any outward
 * coupling: `createNotification` needs the chat-mute predicate and the Expo
 * push sender, which live in other (not yet extracted) sections. Both are
 * INJECTED as `deps` rather than imported, so this module stays a leaf and
 * nothing here re-enters `SupabaseService`.
 *
 * ## What it touches
 *
 * Tables: `notifications`, and `profiles` (read-only, for the per-user
 * in-app-notification setting). No storage buckets, no RPCs.
 *
 * ## The gotcha — cache scoping
 *
 * `getNotificationById` caches under the UNSCOPED key `notification:${id}` and
 * therefore makes its ownership decision OUTSIDE `cacheService.cached`.
 * Hotfix H3 moved it there: inside the loader it ran only on a cache MISS, so
 * the first caller populated the key and every later caller — any user at all
 * — got a hit that skipped the check and read a stranger's notification for
 * the rest of the 5-minute TTL.
 *
 * The key stays unscoped deliberately: three call sites outside that function
 * (`routes/notifications.ts`, and `markNotificationAsRead` /
 * `deleteNotification` below) invalidate by that exact string, and a per-user
 * suffix would leave those deletes matching nothing. Either scope the key or
 * hoist the check; doing neither is the bug.
 *
 * `supabase.notificationAccess.test.ts` calls the delegation on a bare
 * `{ supabase }` stand-in, so the check must stay where it is and the
 * delegation must keep reading `this.supabase`.
 */
import { Notification } from "../../types";
import { cacheService } from "../cache";

import type { DataClient } from "./client";

/**
 * The two things `createNotification` needs from sections that have not been
 * extracted yet. Injected so this module does not import `SupabaseService`.
 */
export type CreateNotificationDeps = {
  isChatMuted: (
    userId: string,
    scopeType: "group" | "dm",
    scopeId: string,
  ) => Promise<boolean>;
  sendExpoPushForNotification: (
    userId: string,
    notification: {
      message: string;
      type?: string;
      link?: string;
      data?: Record<string, unknown>;
    },
  ) => Promise<void>;
};

export async function getUserNotifications(
  supabase: DataClient,
  userId: string,
  options: {
    page?: number;
    limit?: number;
    unreadOnly?: boolean;
  } = {},
): Promise<Notification[]> {
  const { page = 1, limit = 20, unreadOnly = false } = options;
  const offset = (page - 1) * limit;

  const cacheKey = `notifications:${userId}:${page}:${limit}:${unreadOnly}`;

  return cacheService.cached(
    cacheKey,
    async () => {
      let query = supabase
        .from("notifications")
        .select("*")
        .eq("user_id", userId);

      if (unreadOnly) {
        query = query.eq("read", false);
      }

      const { data, error } = await query
        .order("date", { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      return data || [];
    },
    { ttl: 120 },
  ); // Cache for 2 minutes
}

export async function getNotificationById(
  supabase: DataClient,
  notificationId: string,
  userId?: string,
): Promise<Notification | null> {
  // The ownership check MUST live outside `cached`. It used to sit INSIDE
  // the loader, so it ran only on a cache MISS: the first caller populated
  // `notification:${id}` with the row, and every later caller — any user at
  // all — got a HIT that skipped the check and returned a stranger's
  // notification for the next 5 minutes.
  //
  // The key stays unscoped on purpose. What is cached is now the raw row,
  // which is the same for every viewer and carries no access decision, and
  // three call sites outside this method (routes/notifications.ts, and
  // markNotificationRead/deleteNotification below) invalidate by this exact
  // string — a per-user suffix would leave those deletes matching nothing
  // and serve read notifications as unread. Access is decided per call
  // below, so a hit is checked just as strictly as a miss.
  const cacheKey = `notification:${notificationId}`;

  const data = await cacheService.cached(
    cacheKey,
    async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("id", notificationId)
        .single();

      if (error) {
        if (error.code === "PGRST116") return null; // Not found
        throw error;
      }

      return data;
    },
    { ttl: 300 },
  ); // Cache for 5 minutes

  if (!data) return null;
  // Check if notification belongs to user
  if (userId && data.user_id !== userId) {
    return null; // Access denied
  }
  return data;
}

export async function createNotification(
  supabase: DataClient,
  userId: string,
  notificationData: {
    message: string;
    link?: string;
    type?: string;
    data?: Record<string, unknown>;
    force?: boolean;
  },
  deps: CreateNotificationDeps,
): Promise<Notification | null> {
  if (!notificationData.force) {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("settings")
      .eq("id", userId)
      .single();

    if (!profileError && profile) {
      const { shouldCreateInAppNotification } =
        await import("../../utils/userSettingsPolicy");
      if (
        !shouldCreateInAppNotification(
          profile.settings,
          notificationData.type,
        )
      ) {
        return null;
      }
    }

    const type = notificationData.type || "info";
    const { CHAT_MUTEABLE_NOTIFICATION_TYPES } =
      await import("@lantern/shared/utils/chatMute");
    if (CHAT_MUTEABLE_NOTIFICATION_TYPES.has(type)) {
      const data = notificationData.data || {};
      const groupId = typeof data.groupId === "string" ? data.groupId : null;
      const threadId =
        typeof data.threadId === "string" ? data.threadId : null;
      if (groupId && (await deps.isChatMuted(userId, "group", groupId))) {
        return null;
      }
      if (threadId && (await deps.isChatMuted(userId, "dm", threadId))) {
        return null;
      }
    }
  }

  const { data, error } = await supabase
    .from("notifications")
    .insert({
      user_id: userId,
      message: notificationData.message,
      link: notificationData.link,
      type: notificationData.type || "info",
      data: notificationData.data || {},
      read: false,
    })
    .select()
    .single();

  if (error) throw error;

  // Invalidate caches
  await cacheService.deletePattern(`notifications:${userId}:*`);
  await cacheService.delete(`notifications:stats:${userId}`);

  void deps.sendExpoPushForNotification(userId, notificationData);

  return data;
}

export async function markNotificationAsRead(
  supabase: DataClient,
  notificationId: string,
): Promise<Notification | null> {
  const { data, error } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("id", notificationId)
    .select()
    .single();

  if (error) {
    if (error.code === "PGRST116") return null; // Not found
    throw error;
  }

  // Invalidate caches
  await cacheService.delete(`notification:${notificationId}`);
  await cacheService.deletePattern(`notifications:${data.user_id}:*`);
  await cacheService.delete(`notifications:stats:${data.user_id}`);

  return data;
}

export async function markAllNotificationsAsRead(
  supabase: DataClient,
  userId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("user_id", userId)
    .eq("read", false)
    .select("id");

  if (error) throw error;

  const updatedCount = data?.length || 0;

  // Invalidate caches
  await cacheService.deletePattern(`notifications:${userId}:*`);
  await cacheService.delete(`notifications:stats:${userId}`);

  return updatedCount;
}

export async function deleteNotification(
  supabase: DataClient,
  notificationId: string,
): Promise<boolean> {
  // Get notification first to know which user to invalidate
  const { data: notification, error: fetchError } = await supabase
    .from("notifications")
    .select("user_id")
    .eq("id", notificationId)
    .single();

  if (fetchError) {
    if (fetchError.code === "PGRST116") return false; // Not found
    throw fetchError;
  }

  const { error } = await supabase
    .from("notifications")
    .delete()
    .eq("id", notificationId);

  if (error) throw error;

  // Invalidate caches
  await cacheService.delete(`notification:${notificationId}`);
  await cacheService.deletePattern(`notifications:${notification.user_id}:*`);
  await cacheService.delete(`notifications:stats:${notification.user_id}`);

  return true;
}

export async function deleteAllNotifications(
  supabase: DataClient,
  userId: string,
): Promise<number> {
  // Count notifications first
  const { count, error: countError } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);

  if (countError) throw countError;

  // Delete all notifications for user
  const { error } = await supabase
    .from("notifications")
    .delete()
    .eq("user_id", userId);

  if (error) throw error;

  // Invalidate caches
  await cacheService.deletePattern(`notifications:${userId}:*`);
  await cacheService.deletePattern(`notification:*`);
  await cacheService.delete(`notifications:stats:${userId}`);

  return count || 0;
}

export async function getNotificationStats(
  supabase: DataClient,
  userId: string,
): Promise<{
  total: number;
  unread: number;
  read: number;
}> {
  const cacheKey = `notifications:stats:${userId}`;

  return cacheService.cached(
    cacheKey,
    async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("read")
        .eq("user_id", userId);

      if (error) throw error;

      const total = data?.length || 0;
      const unread = data?.filter((n) => !n.read).length || 0;
      const read = total - unread;

      return { total, unread, read };
    },
    { ttl: 60 },
  ); // Cache for 1 minute
}

export async function createBulkNotifications(
  supabase: DataClient,
  notifications: Array<{
    userId: string;
    message: string;
    link?: string;
    type?: string;
  }>,
): Promise<Notification[]> {
  const notificationsToInsert = notifications.map((n) => ({
    user_id: n.userId,
    message: n.message,
    link: n.link,
    type: n.type || "info",
    read: false,
  }));

  const { data, error } = await supabase
    .from("notifications")
    .insert(notificationsToInsert)
    .select();

  if (error) throw error;

  // Invalidate caches for affected users
  const affectedUserIds = [...new Set(notifications.map((n) => n.userId))];
  for (const userId of affectedUserIds) {
    await cacheService.deletePattern(`notifications:${userId}:*`);
  }

  return data || [];
}
