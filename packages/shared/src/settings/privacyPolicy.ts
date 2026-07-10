import type { PrivacySettings } from './userSettings';
import { normalizeUserSettings } from './userSettings';

export type OnlineStatus = 'online' | 'offline' | 'hidden';

const ONLINE_THRESHOLD_MS = 5 * 60 * 1000;

export function userSharesStudyActivity(settings: Pick<PrivacySettings, 'showStudyActivity'>): boolean {
  return settings.showStudyActivity !== false;
}

export function userShowsOnlineStatus(settings: Pick<PrivacySettings, 'showOnlineStatus'>): boolean {
  return settings.showOnlineStatus !== false;
}

export function userDiscoverableForInvites(
  settings: Pick<PrivacySettings, 'discoverableForInvites'>
): boolean {
  return settings.discoverableForInvites !== false;
}

export function canViewStudyActivity(rawTargetSettings: unknown): boolean {
  const settings = normalizeUserSettings(rawTargetSettings);
  return userSharesStudyActivity(settings.privacy);
}

export function isUserRecentlyActive(lastSeenAt: string | Date | null | undefined, now = Date.now()): boolean {
  if (!lastSeenAt) return false;
  const ts = typeof lastSeenAt === 'string' ? Date.parse(lastSeenAt) : lastSeenAt.getTime();
  if (!Number.isFinite(ts)) return false;
  return now - ts <= ONLINE_THRESHOLD_MS;
}

export function resolvePublicOnlineStatus(
  rawTargetSettings: unknown,
  lastSeenAt: string | Date | null | undefined,
  now = Date.now()
): OnlineStatus {
  const settings = normalizeUserSettings(rawTargetSettings);
  if (!userShowsOnlineStatus(settings.privacy)) return 'hidden';
  return isUserRecentlyActive(lastSeenAt, now) ? 'online' : 'offline';
}

export function shouldSendEmailNotifications(rawSettings: unknown): boolean {
  return normalizeUserSettings(rawSettings).notifications.emailEnabled;
}

export function shouldSendWeeklyDigest(rawSettings: unknown): boolean {
  const settings = normalizeUserSettings(rawSettings);
  return settings.notifications.emailEnabled && settings.notifications.weeklyDigest;
}

export function scrubStudyActivityForPrivacy<T extends { count?: number }>(
  rawTargetSettings: unknown,
  activity: T[]
): T[] {
  if (canViewStudyActivity(rawTargetSettings)) return activity;
  return activity.map((row) => ({ ...row, count: 0 }));
}

export function getPrivacySafeProfileFields(
  rawTargetSettings: unknown,
  lastSeenAt: string | null | undefined
): { onlineStatus: OnlineStatus; showStudyActivity: boolean } {
  const settings = normalizeUserSettings(rawTargetSettings);
  return {
    onlineStatus: resolvePublicOnlineStatus(rawTargetSettings, lastSeenAt),
    showStudyActivity: userSharesStudyActivity(settings.privacy),
  };
}
