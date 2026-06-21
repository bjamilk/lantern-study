import { normalizeUserSettings } from '@lantern/shared/settings';

/**
 * Privileged settings keys that must never be writable by end users.
 * Ban state and admin flags are set only via admin routes / service role.
 */
export const PRIVILEGED_SETTINGS_KEYS = new Set([
  'is_banned',
  'account_status',
  'is_platform_admin',
  'ban_reason',
  'banned_at',
  'banned_by',
  'suspended_until',
  'moderation_flags',
]);

export function stripPrivilegedSettings(
  incoming: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return {};
  }
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (!PRIVILEGED_SETTINGS_KEYS.has(key)) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function preservePrivilegedKeys(
  merged: Record<string, unknown>,
  existing: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...merged };
  for (const key of PRIVILEGED_SETTINGS_KEYS) {
    if (key in existing) {
      result[key] = existing[key];
    }
  }
  return result;
}

/**
 * Deep-merge user settings into canonical nested schema while preserving privileged keys.
 */
export function mergeUserSettings(
  existing: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const base =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...existing }
      : {};
  const safeIncoming = stripPrivilegedSettings(incoming);
  const normalized = normalizeUserSettings({ ...base, ...safeIncoming });
  return preservePrivilegedKeys(
    normalized as unknown as Record<string, unknown>,
    base
  );
}

export function isPushEnabledInSettings(settings: unknown): boolean {
  return normalizeUserSettings(settings).notifications.pushEnabled;
}
