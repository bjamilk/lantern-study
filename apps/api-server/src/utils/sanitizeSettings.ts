import {
  PRIVILEGED_SETTINGS_KEYS,
  applySettingsPatch,
  normalizeUserSettings,
  type UserSettingsPatch,
} from '@lantern/shared/settings';
import { isTutorStyleId } from '@lantern/shared/ai';

/**
 * Privileged settings keys that must never be writable by end users.
 * Ban state and admin flags are set only via admin routes / service role.
 *
 * The list itself lives in `@lantern/shared/settings` and is re-exported here
 * unchanged: `normalizeSyncClassSkipped` needs the same names (a client writes
 * the KEYS of that map), and two copies would drift.
 */
export { PRIVILEGED_SETTINGS_KEYS };

const SETTINGS_CATEGORY_KEYS = [
  'notifications',
  'study',
  'appearance',
  'privacy',
  'accessibility',
  'sync',
  'marketplace',
  'featureTips',
  // Non-privileged: three booleans saying which onboarding surfaces the
  // student has ever opened (#68). `applySettingsPatch` shape-checks it to
  // exactly those three, drops every unknown sub-key, and ORs rather than
  // replaces — so it can neither smuggle a privileged key nor un-tick a
  // surface another device already recorded.
  'onboardingVisited',
  // Non-privileged: a flat map of study-set id → when the student tapped "Skip
  // for now" on the Sync-with-your-class card. `applySettingsPatch` runs it
  // through `mergeSyncClassSkipped`, which drops every key that is not
  // id-shaped and every value that is not a timestamp, unions rather than
  // replaces, and caps the map — so it can neither smuggle anything nor grow
  // without bound, and no client can un-skip a card another device hid.
  'syncClassSkipped',
  'flashcardGeneration',
  // The recorder's two language choices (W1). A category rather than a scalar
  // because there are two of them, and `applySettingsPatch` narrows both
  // through the shared allowlists — an unknown language, a smuggled object or
  // a privileged key name under this key never survives the patch.
  'lecture',
  // NOTE: `tutorStyle` is deliberately NOT here. This list is for CATEGORY
  // objects; the tutor style is a scalar and is read separately below.
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

  // The one SCALAR preference (F2): which tutor style the companion answers in.
  // It cannot go through the category loop above — that requires an object —
  // and it is read by a strict four-id allowlist rather than by type, so a
  // string of any other shape is dropped here rather than stored. A nested
  // object, an array or a privileged key name under this key is not a string
  // and never reaches the patch, so this key cannot smuggle anything.
  const rawTutorStyle = safe.tutorStyle;
  if (isTutorStyleId(rawTutorStyle)) {
    patch.tutorStyle = rawTutorStyle;
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
