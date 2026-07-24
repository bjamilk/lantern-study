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

export async function canRecipientReceiveDirectMessage(
  supabase: { from: (table: string) => any },
  senderId: string,
  recipientId: string,
  recipientSettingsRaw: unknown
): Promise<{ allowed: boolean; reason?: string }> {
  if (senderId === recipientId) {
    return { allowed: false, reason: 'Cannot message yourself' };
  }

  const policy = getDirectMessagePolicy(recipientSettingsRaw);

  if (policy === 'none') {
    return { allowed: false, reason: 'This user does not accept direct messages' };
  }

  if (policy === 'everyone') {
    return { allowed: true };
  }

  const shareGroup = await usersShareConfirmedGroup(supabase, senderId, recipientId);
  if (!shareGroup) {
    return {
      allowed: false,
      reason: 'This user only accepts direct messages from shared group members',
    };
  }

  return { allowed: true };
}

export { canViewStudyActivity, resolvePublicOnlineStatus, shouldSendEmailNotifications, shouldSendWeeklyDigest };
