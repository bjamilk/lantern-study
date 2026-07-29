/**
 * Deep category-patch helpers and range validation for UserSettings.
 * Used by API merge, web save queue, and mobile offline sync.
 */
import {
  DEFAULT_USER_SETTINGS,
  type AccessibilitySettings,
  type AppearanceSettings,
  type FeatureTipsSettings,
  type MarketplaceSettings,
  type NotificationSettings,
  type PrivacySettings,
  type StudySettings,
  type SyncSettings,
  type UserSettings,
  normalizeUserSettings,
} from './userSettings';

export type SettingsCategoryKey =
  | 'notifications'
  | 'study'
  | 'appearance'
  | 'privacy'
  | 'accessibility'
  | 'sync'
  | 'marketplace'
  | 'featureTips';

/** Partial nested settings blob (one or more categories). */
export type UserSettingsPatch = {
  notifications?: Partial<NotificationSettings>;
  study?: Partial<StudySettings>;
  appearance?: Partial<AppearanceSettings>;
  privacy?: Partial<PrivacySettings>;
  accessibility?: Partial<AccessibilitySettings>;
  sync?: Partial<SyncSettings>;
  marketplace?: Partial<MarketplaceSettings>;
  featureTips?: Partial<FeatureTipsSettings>;
  version?: number;
  updatedAt?: string;
};

const REMINDER_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ACCENT_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function sanitizeStudy(partial: Partial<StudySettings>, base: StudySettings): StudySettings {
  return {
    dailyCardGoal: clampNumber(partial.dailyCardGoal ?? base.dailyCardGoal, 5, 100, base.dailyCardGoal),
    dailyTestGoal: clampNumber(partial.dailyTestGoal ?? base.dailyTestGoal, 0, 10, base.dailyTestGoal),
    srsNewCardsPerDay: clampNumber(
      partial.srsNewCardsPerDay ?? base.srsNewCardsPerDay,
      5,
      50,
      base.srsNewCardsPerDay
    ),
    srsEasyBonus: clampNumber(partial.srsEasyBonus ?? base.srsEasyBonus, 1, 3, base.srsEasyBonus),
    srsIntervalModifier: clampNumber(
      partial.srsIntervalModifier ?? base.srsIntervalModifier,
      50,
      200,
      base.srsIntervalModifier
    ),
    srsMaxInterval: clampNumber(partial.srsMaxInterval ?? base.srsMaxInterval, 30, 365, base.srsMaxInterval),
    defaultTestMode: asEnum(partial.defaultTestMode ?? base.defaultTestMode, ['study', 'exam'] as const, base.defaultTestMode),
    showExplanationsImmediately: asBoolean(
      partial.showExplanationsImmediately ?? base.showExplanationsImmediately,
      base.showExplanationsImmediately
    ),
    autoAdvanceDelay: clampNumber(
      partial.autoAdvanceDelay ?? base.autoAdvanceDelay,
      0,
      30,
      base.autoAdvanceDelay
    ),
    shuffleQuestions: asBoolean(partial.shuffleQuestions ?? base.shuffleQuestions, base.shuffleQuestions),
    shuffleOptions: asBoolean(partial.shuffleOptions ?? base.shuffleOptions, base.shuffleOptions),
    autoPlayAudio: asBoolean(partial.autoPlayAudio ?? base.autoPlayAudio, base.autoPlayAudio),
    showCardProgress: asBoolean(partial.showCardProgress ?? base.showCardProgress, base.showCardProgress),
  };
}

function sanitizeNotifications(
  partial: Partial<NotificationSettings>,
  base: NotificationSettings
): NotificationSettings {
  const reminderRaw = partial.reminderTime ?? base.reminderTime;
  const reminderTime =
    typeof reminderRaw === 'string' && REMINDER_TIME_RE.test(reminderRaw)
      ? reminderRaw
      : base.reminderTime;
  return {
    pushEnabled: asBoolean(partial.pushEnabled ?? base.pushEnabled, base.pushEnabled),
    dailyReminder: asBoolean(partial.dailyReminder ?? base.dailyReminder, base.dailyReminder),
    reminderTime,
    groupActivity: asBoolean(partial.groupActivity ?? base.groupActivity, base.groupActivity),
    marketplaceUpdates: asBoolean(
      partial.marketplaceUpdates ?? base.marketplaceUpdates,
      base.marketplaceUpdates
    ),
    badgeUnlocks: asBoolean(partial.badgeUnlocks ?? base.badgeUnlocks, base.badgeUnlocks),
    srsReminders: asBoolean(partial.srsReminders ?? base.srsReminders, base.srsReminders),
    testResults: asBoolean(partial.testResults ?? base.testResults, base.testResults),
    emailEnabled: asBoolean(partial.emailEnabled ?? base.emailEnabled, base.emailEnabled),
    weeklyDigest: asBoolean(partial.weeklyDigest ?? base.weeklyDigest, base.weeklyDigest),
    groupInvites: asBoolean(partial.groupInvites ?? base.groupInvites, base.groupInvites),
  };
}

function sanitizeAppearance(
  partial: Partial<AppearanceSettings>,
  base: AppearanceSettings
): AppearanceSettings {
  const accentRaw = partial.accentColor ?? base.accentColor;
  const accentColor =
    typeof accentRaw === 'string' && ACCENT_COLOR_RE.test(accentRaw) ? accentRaw : base.accentColor;
  return {
    theme: asEnum(partial.theme ?? base.theme, ['light', 'dark', 'system'] as const, base.theme),
    accentColor,
    fontSize: asEnum(
      partial.fontSize ?? base.fontSize,
      ['small', 'medium', 'large'] as const,
      base.fontSize
    ),
    compactMode: asBoolean(partial.compactMode ?? base.compactMode, base.compactMode),
    showAnimations: asBoolean(partial.showAnimations ?? base.showAnimations, base.showAnimations),
    lowDataMode: asBoolean(partial.lowDataMode ?? base.lowDataMode, base.lowDataMode),
  };
}

function sanitizePrivacy(partial: Partial<PrivacySettings>, base: PrivacySettings): PrivacySettings {
  return {
    profileVisibility: asEnum(
      partial.profileVisibility ?? base.profileVisibility,
      ['public', 'groups', 'private'] as const,
      base.profileVisibility
    ),
    discoverableForInvites: asBoolean(
      partial.discoverableForInvites ?? base.discoverableForInvites,
      base.discoverableForInvites
    ),
    showOnlineStatus: asBoolean(partial.showOnlineStatus ?? base.showOnlineStatus, base.showOnlineStatus),
    showStudyActivity: asBoolean(
      partial.showStudyActivity ?? base.showStudyActivity,
      base.showStudyActivity
    ),
    allowDirectMessages: asEnum(
      partial.allowDirectMessages ?? base.allowDirectMessages,
      ['everyone', 'groups', 'none'] as const,
      base.allowDirectMessages
    ),
  };
}

function sanitizeAccessibility(
  partial: Partial<AccessibilitySettings>,
  base: AccessibilitySettings
): AccessibilitySettings {
  return {
    reduceMotion: asBoolean(partial.reduceMotion ?? base.reduceMotion, base.reduceMotion),
    highContrast: asBoolean(partial.highContrast ?? base.highContrast, base.highContrast),
    screenReaderOptimized: asBoolean(
      partial.screenReaderOptimized ?? base.screenReaderOptimized,
      base.screenReaderOptimized
    ),
    hapticFeedback: asBoolean(partial.hapticFeedback ?? base.hapticFeedback, base.hapticFeedback),
  };
}

function sanitizeSync(partial: Partial<SyncSettings>, base: SyncSettings): SyncSettings {
  const last =
    partial.lastSyncTime === null
      ? null
      : typeof partial.lastSyncTime === 'string'
        ? partial.lastSyncTime
        : base.lastSyncTime;
  return {
    autoSync: asBoolean(partial.autoSync ?? base.autoSync, base.autoSync),
    syncOnWifiOnly: asBoolean(partial.syncOnWifiOnly ?? base.syncOnWifiOnly, base.syncOnWifiOnly),
    lastSyncTime: last,
    syncConflictResolution: asEnum(
      partial.syncConflictResolution ?? base.syncConflictResolution,
      ['local', 'remote', 'ask'] as const,
      base.syncConflictResolution
    ),
  };
}

function sanitizeMarketplace(
  partial: Partial<MarketplaceSettings>,
  base: MarketplaceSettings
): MarketplaceSettings {
  const country =
    typeof partial.country_code === 'string' && partial.country_code.trim()
      ? partial.country_code.trim().toUpperCase().slice(0, 2)
      : base.country_code;
  return {
    country_code: country || 'NG',
    campus_id:
      partial.campus_id === null
        ? null
        : typeof partial.campus_id === 'string'
          ? partial.campus_id
          : (base.campus_id ?? null),
    campus_other:
      partial.campus_other === null
        ? null
        : typeof partial.campus_other === 'string'
          ? partial.campus_other
          : (base.campus_other ?? null),
  };
}

function sanitizeFeatureTips(
  partial: Partial<FeatureTipsSettings>,
  base: FeatureTipsSettings
): FeatureTipsSettings {
  const checklist =
    partial.checklist && typeof partial.checklist === 'object' && !Array.isArray(partial.checklist)
      ? (partial.checklist as Record<string, boolean>)
      : (base.checklist ?? {});
  return {
    version: 2,
    dismissed: {},
    skippedAll: asBoolean(partial.skippedAll ?? base.skippedAll, Boolean(base.skippedAll)),
    dontShowAgain: asBoolean(partial.dontShowAgain ?? base.dontShowAgain, Boolean(base.dontShowAgain)),
    checklistDismissed: asBoolean(
      partial.checklistDismissed ?? base.checklistDismissed,
      Boolean(base.checklistDismissed)
    ),
    checklist,
  };
}

/**
 * Apply a partial nested patch onto current settings with deep category merge + validation.
 * Privileged top-level keys are not accepted here (server strips them separately).
 */
export function applySettingsPatch(
  current: UserSettings | unknown,
  patch: UserSettingsPatch | Record<string, unknown> | null | undefined
): UserSettings {
  const base = normalizeUserSettings(current);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ...base, updatedAt: new Date().toISOString() };
  }

  const p = patch as UserSettingsPatch;
  const next: UserSettings = {
    ...base,
    notifications: p.notifications
      ? sanitizeNotifications(p.notifications, base.notifications)
      : base.notifications,
    study: p.study ? sanitizeStudy(p.study, base.study) : base.study,
    appearance: p.appearance ? sanitizeAppearance(p.appearance, base.appearance) : base.appearance,
    privacy: p.privacy ? sanitizePrivacy(p.privacy, base.privacy) : base.privacy,
    accessibility: p.accessibility
      ? sanitizeAccessibility(p.accessibility, base.accessibility)
      : base.accessibility,
    sync: p.sync ? sanitizeSync(p.sync, base.sync) : base.sync,
    marketplace: p.marketplace
      ? sanitizeMarketplace(p.marketplace, base.marketplace ?? DEFAULT_USER_SETTINGS.marketplace!)
      : base.marketplace,
    featureTips: p.featureTips
      ? sanitizeFeatureTips(p.featureTips, base.featureTips ?? DEFAULT_USER_SETTINGS.featureTips!)
      : base.featureTips,
    version: typeof p.version === 'number' && Number.isFinite(p.version) ? p.version : base.version,
    updatedAt: new Date().toISOString(),
  };
  return next;
}

/** Extract a category-only patch from a full settings object relative to a base. */
export function diffSettingsPatch(
  previous: UserSettings,
  next: UserSettings
): UserSettingsPatch {
  const patch: UserSettingsPatch = {};
  const categories: SettingsCategoryKey[] = [
    'notifications',
    'study',
    'appearance',
    'privacy',
    'accessibility',
    'sync',
    'marketplace',
    'featureTips',
  ];
  for (const key of categories) {
    const prevCat = previous[key];
    const nextCat = next[key];
    if (JSON.stringify(prevCat) !== JSON.stringify(nextCat) && nextCat != null) {
      (patch as Record<string, unknown>)[key] = nextCat;
    }
  }
  return patch;
}

/** Merge two patches (later wins per field within each category). */
export function mergeSettingsPatches(
  a: UserSettingsPatch | null | undefined,
  b: UserSettingsPatch | null | undefined
): UserSettingsPatch {
  const left = a && typeof a === 'object' ? a : {};
  const right = b && typeof b === 'object' ? b : {};
  const keys = new Set([
    ...Object.keys(left),
    ...Object.keys(right),
  ]) as Set<keyof UserSettingsPatch>;
  const out: UserSettingsPatch = {};
  for (const key of keys) {
    const lv = left[key];
    const rv = right[key];
    if (
      lv &&
      rv &&
      typeof lv === 'object' &&
      typeof rv === 'object' &&
      !Array.isArray(lv) &&
      !Array.isArray(rv)
    ) {
      (out as Record<string, unknown>)[key] = { ...(lv as object), ...(rv as object) };
    } else if (rv !== undefined) {
      (out as Record<string, unknown>)[key] = rv;
    } else if (lv !== undefined) {
      (out as Record<string, unknown>)[key] = lv;
    }
  }
  return out;
}

/** Validate study draft strings used by web SettingsModal. */
export function parseStudyDraftNumber(
  raw: string,
  fallback: number,
  min: number,
  max: number
): number {
  const trimmed = String(raw ?? '').trim();
  if (trimmed === '') return fallback;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
