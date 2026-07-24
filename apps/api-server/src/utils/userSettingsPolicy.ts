import {
  normalizeUserSettings,
  type NotificationSettings,
  type UserSettings,
} from '@lantern/shared/settings';
import {
  canViewStudyActivity,
  resolvePublicOnlineStatus,
  shouldSendEmailNotifications,
  shouldSendWeeklyDigest,
} from '@lantern/shared/settings';

/** Notification types that always deliver (admin, security). */
const ALWAYS_DELIVER_TYPES = new Set([
  'warning',
  'account',
  'security',
  'admin',
]);

const NOTIFICATION_PREF_BY_TYPE: Record<string, keyof NotificationSettings | null> = {
  group_activity: 'groupActivity',
  group_message: 'groupActivity',
  mention: 'groupActivity',
  reply: 'groupActivity',
  group_invite: 'groupInvites',
  badge_unlock: 'badgeUnlocks',
  badge: 'badgeUnlocks',
  marketplace_inquiry: 'marketplaceUpdates',
  marketplace_purchase: 'marketplaceUpdates',
  marketplace_order_update: 'marketplaceUpdates',
  marketplace_review_prompt: 'marketplaceUpdates',
  saved_search_match: 'marketplaceUpdates',
  marketplace_abandoned_reminder: 'marketplaceUpdates',
  marketplace_offer_reminder: 'marketplaceUpdates',
  marketplace_favorite_alert: 'marketplaceUpdates',
  marketplace_seller_campaign: 'marketplaceUpdates',
  marketplace_favorite_milestone: 'marketplaceUpdates',
  marketplace: 'marketplaceUpdates',
  test_result: 'testResults',
  srs_reminder: 'srsReminders',
  daily_reminder: 'dailyReminder',
  challenge_invite: 'groupActivity',
  challenge_accepted: 'groupActivity',
  challenge_declined: 'groupActivity',
  challenge_result: 'testResults',
  challenge_opponent_finished: 'testResults',
  dm_message: 'groupActivity',
  dm_message_request: 'groupActivity',
};

export function parseUserSettings(raw: unknown): UserSettings {
  return normalizeUserSettings(raw);
}

export function shouldCreateInAppNotification(
  rawSettings: unknown,
  notificationType?: string
): boolean {
  if (!notificationType || ALWAYS_DELIVER_TYPES.has(notificationType)) {
    return true;
  }

  const prefKey = NOTIFICATION_PREF_BY_TYPE[notificationType];
  if (!prefKey) {
    return true;
  }

  const settings = parseUserSettings(rawSettings);
  return Boolean(settings.notifications[prefKey]);
}

export function shouldSendExpoPush(
  rawSettings: unknown,
  notificationType?: string
): boolean {
  const settings = parseUserSettings(rawSettings);
  if (!settings.notifications.pushEnabled) {
    return false;
  }

  return shouldCreateInAppNotification(rawSettings, notificationType);
}

export type DirectMessagePolicy = 'everyone' | 'groups' | 'none';

export type DmThreadStatus = 'open' | 'pending' | 'declined';

export type DirectMessageAccess =
  | { mode: 'allow' }
  | { mode: 'request' }
  | { mode: 'deny'; reason: string };

export function getDirectMessagePolicy(rawSettings: unknown): DirectMessagePolicy {
  const settings = parseUserSettings(rawSettings);
  return settings.privacy.allowDirectMessages;
}

export async function usersShareConfirmedGroup(
  supabase: { from: (table: string) => any },
  userIdA: string,
  userIdB: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('group_members')
    .select('group_id')
    .eq('user_id', userIdA)
    .eq('pending', false);

  if (error || !data?.length) {
    return false;
  }

  const groupIds = data.map((row: { group_id: string }) => row.group_id);
  const { count, error: otherError } = await supabase
    .from('group_members')
    .select('group_id', { count: 'exact', head: true })
    .eq('user_id', userIdB)
    .eq('pending', false)
    .in('group_id', groupIds);

  if (otherError) {
    return false;
  }

  return (count ?? 0) > 0;
}

/** Deterministic DM thread id used across the API. */
export function buildDmThreadId(userIdA: string, userIdB: string): string {
  return [userIdA, userIdB].sort().join('-');
}

export async function getDmThreadAccessState(
  supabase: { from: (table: string) => any },
  userIdA: string,
  userIdB: string
): Promise<{ status: DmThreadStatus; requestedBy: string | null } | null> {
  if (!userIdA || !userIdB || userIdA === userIdB) return null;
  const threadId = buildDmThreadId(userIdA, userIdB);
  const { data, error } = await supabase
    .from('dm_threads')
    .select('id, status, requested_by')
    .eq('id', threadId)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    return null;
  }
  if (!data?.id) return null;

  const status =
    data.status === 'pending' || data.status === 'declined' || data.status === 'open'
      ? (data.status as DmThreadStatus)
      : 'open';

  return {
    status,
    requestedBy: typeof data.requested_by === 'string' ? data.requested_by : null,
  };
}

/**
 * True when an open (two-way) DM thread already exists between the two users.
 * Pending/declined requests do not count as established conversations.
 */
export async function usersHaveExistingDmThread(
  supabase: { from: (table: string) => any },
  userIdA: string,
  userIdB: string
): Promise<boolean> {
  const state = await getDmThreadAccessState(supabase, userIdA, userIdB);
  return state?.status === 'open';
}

/** True when either user has blocked the other (full mutual DM block). */
export async function usersAreBlocked(
  supabase: { from: (table: string) => any },
  userIdA: string,
  userIdB: string
): Promise<boolean> {
  if (!userIdA || !userIdB || userIdA === userIdB) return false;

  const forward = supabase
    .from('user_blocks')
    .select('blocker_id')
    .eq('blocker_id', userIdA)
    .eq('blocked_id', userIdB)
    .maybeSingle();
  const reverse = supabase
    .from('user_blocks')
    .select('blocker_id')
    .eq('blocker_id', userIdB)
    .eq('blocked_id', userIdA)
    .maybeSingle();

  const [a, b] = await Promise.all([forward, reverse]);
  if (a.error || b.error) {
    // Prefer availability over hard-failing every DM on a transient query error.
    return false;
  }
  return !!(a.data?.blocker_id || b.data?.blocker_id);
}

/**
 * Resolve whether a DM may be sent as a normal message, as a message request,
 * or must be denied. Marketplace / admin paths use bypassPrivacy instead —
 * except blocks, which always deny.
 */
export async function resolveDirectMessageAccess(
  supabase: { from: (table: string) => any },
  senderId: string,
  recipientId: string,
  recipientSettingsRaw: unknown
): Promise<DirectMessageAccess> {
  if (senderId === recipientId) {
    return { mode: 'deny', reason: 'Cannot message yourself' };
  }

  if (await usersAreBlocked(supabase, senderId, recipientId)) {
    return { mode: 'deny', reason: 'You cannot message this user' };
  }

  const thread = await getDmThreadAccessState(supabase, senderId, recipientId);

  if (thread?.status === 'open') {
    return { mode: 'allow' };
  }

  if (thread?.status === 'pending') {
    // Requester may keep messaging one-way; recipient reply opens the thread.
    if (thread.requestedBy === senderId) {
      return { mode: 'request' };
    }
    // Recipient messaging back accepts the request.
    return { mode: 'allow' };
  }

  if (thread?.status === 'declined') {
    // Only the original requester may send again (re-opens as a request).
    if (thread.requestedBy === senderId) {
      return { mode: 'request' };
    }
    return {
      mode: 'deny',
      reason: 'This message request was declined',
    };
  }

  const policy = getDirectMessagePolicy(recipientSettingsRaw);

  if (policy === 'everyone') {
    return { mode: 'allow' };
  }

  if (policy === 'none') {
    return { mode: 'deny', reason: 'This user does not accept direct messages' };
  }

  // policy === 'groups'
  const shareGroup = await usersShareConfirmedGroup(supabase, senderId, recipientId);
  if (shareGroup) {
    return { mode: 'allow' };
  }

  // Cold DM to someone outside shared groups → message request (one-way until accepted).
  return { mode: 'request' };
}

/** @deprecated Prefer resolveDirectMessageAccess — kept for callers that only need allow/deny. */
export async function canRecipientReceiveDirectMessage(
  supabase: { from: (table: string) => any },
  senderId: string,
  recipientId: string,
  recipientSettingsRaw: unknown
): Promise<{ allowed: boolean; reason?: string; asRequest?: boolean }> {
  const access = await resolveDirectMessageAccess(
    supabase,
    senderId,
    recipientId,
    recipientSettingsRaw
  );
  if (access.mode === 'deny') {
    return { allowed: false, reason: access.reason };
  }
  return { allowed: true, asRequest: access.mode === 'request' };
}

export { canViewStudyActivity, resolvePublicOnlineStatus, shouldSendEmailNotifications, shouldSendWeeklyDigest };
