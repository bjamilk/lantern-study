import {
  ONLINE_THRESHOLD_MS,
  resolvePublicOnlineStatus,
  type OnlineStatus,
} from '../settings/privacyPolicy';

export type ChatPresenceLine = {
  status: OnlineStatus;
  label: string | null;
};

function minutesAgoLabel(lastSeenAt: string | Date, now: number): string {
  const ts = typeof lastSeenAt === 'string' ? Date.parse(lastSeenAt) : lastSeenAt.getTime();
  if (!Number.isFinite(ts)) return 'last seen recently';
  const mins = Math.max(1, Math.round((now - ts) / 60_000));
  if (mins < 60) return `last seen ${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `last seen ${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `last seen ${days}d ago`;
  return `last seen ${new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

/**
 * DM header subtitle. Hidden when the peer hides online status.
 * `online` / `last seen 12m ago` / null.
 */
export function formatChatPresenceLine(
  rawTargetSettings: unknown,
  lastSeenAt: string | Date | null | undefined,
  now = Date.now(),
): ChatPresenceLine {
  const status = resolvePublicOnlineStatus(rawTargetSettings, lastSeenAt, now);
  if (status === 'hidden') return { status, label: null };
  if (status === 'online') return { status, label: 'online' };
  if (!lastSeenAt) return { status, label: null };
  return { status, label: minutesAgoLabel(lastSeenAt, now) };
}

export function formatChatPresenceFromStatus(
  status: OnlineStatus | null | undefined,
  lastSeenAt?: string | Date | null,
  now = Date.now(),
): string | null {
  if (!status || status === 'hidden') return null;
  if (status === 'online') return 'online';
  if (!lastSeenAt) return null;
  return minutesAgoLabel(lastSeenAt, now);
}

export { ONLINE_THRESHOLD_MS };
