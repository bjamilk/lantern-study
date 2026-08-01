import {
  applySettingsPatch,
  normalizeUserSettings,
  type UserSettingsPatch,
} from '@lantern/shared/settings';

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

const SETTINGS_CATEGORY_KEYS = [
  'notifications',
  'study',
  'appearance',
  'privacy',
  'accessibility',
  'sync',
  'marketplace',
  'featureTips',
] as const;

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
 * Convert an arbitrary incoming settings body into a deep category patch.
 * Supports nested categories and a small set of legacy flat keys.
 */
export function toSettingsPatch(
  incoming: Record<string, unknown> | null | undefined
): UserSettingsPatch {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return {};
  }
  const safe = stripPrivilegedSettings(incoming);
  delete (safe as { test_presets?: unknown }).test_presets;

  const patch: UserSettingsPatch = {};
  for (const key of SETTINGS_CATEGORY_KEYS) {
    const value = safe[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      (patch as Record<string, unknown>)[key] = value;
    }
  }

  // Legacy flat theme (pre-nested schema).
  if (
    !patch.appearance &&
    (safe.theme === 'light' || safe.theme === 'dark' || safe.theme === 'system')
  ) {
    patch.appearance = { theme: safe.theme };
  }

  // Legacy flat notification toggles.
  const legacyNotifKeys = [
    'dailyReminder',
    'groupActivity',
    'marketplaceUpdates',
    'badgeUnlocks',
    'srsReminders',
    'testResults',
    'pushEnabled',
    'emailEnabled',
    'weeklyDigest',
    'groupInvites',
    'reminderTime',
  ] as const;
  if (!patch.notifications) {
    const legacyNotif: Record<string, unknown> = {};
    for (const key of legacyNotifKeys) {
      if (key in safe) legacyNotif[key] = safe[key];
    }
    if (Object.keys(legacyNotif).length > 0) {
      patch.notifications = legacyNotif as UserSettingsPatch['notifications'];
    }
  }

  return patch;
}

/**
 * Deep-merge user settings category patches into canonical nested schema
 * while preserving privileged keys and validating ranges/enums.
 */
export function mergeUserSettings(
  existing: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const base =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...existing }
      : {};
  delete (base as { test_presets?: unknown }).test_presets;

  const patch = toSettingsPatch(incoming);
  const normalized = applySettingsPatch(normalizeUserSettings(base), patch);
  return preservePrivilegedKeys(
    normalized as unknown as Record<string, unknown>,
    base
  );
}

export function isPushEnabledInSettings(settings: unknown): boolean {
  return normalizeUserSettings(settings).notifications.pushEnabled;
}
