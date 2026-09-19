/**
 * Deep category-patch helpers and range validation for UserSettings.
 * Used by API merge, web save queue, and mobile offline sync.
 */
import { normalizeGenerationOptions } from '../flashcards/generationOptions';
import { normalizeTutorStyleId, type TutorStyleId } from '../ai/tutorStyles';
import {
  DEFAULT_USER_SETTINGS,
  type AccessibilitySettings,
  type AppearanceSettings,
  type FeatureTipsSettings,
  type FlashcardGenerationSettings,
  type LectureSettings,
  type MarketplaceSettings,
  type NotificationSettings,
  type OnboardingVisitedSettings,
  type PrivacySettings,
  type StudySettings,
  type SyncSettings,
  type UserSettings,
  mergeOnboardingVisited,
  normalizeLectureSettings,
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
  | 'featureTips'
  | 'onboardingVisited'
  | 'flashcardGeneration'
  | 'lecture';

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
  onboardingVisited?: Partial<OnboardingVisitedSettings>;
  flashcardGeneration?: Partial<FlashcardGenerationSettings>;
  lecture?: Partial<LectureSettings>;
  /**
   * Not a category — a scalar, so it is patched by VALUE and is deliberately
   * absent from `SettingsCategoryKey` and from the category loops below (both
   * of which assume an object and would drop or mangle a string).
   */
  tutorStyle?: TutorStyleId;
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
    lockAnsweredQuestions: asBoolean(partial.lockAnsweredQuestions ?? base.lockAnsweredQuestions, base.lockAnsweredQuestions),
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
    examReminders: asBoolean(partial.examReminders ?? base.examReminders, base.examReminders),
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
  // Deep-merge checklist keys so phone + laptop progress does not clobber.
  const incomingChecklist =
    partial.checklist && typeof partial.checklist === 'object' && !Array.isArray(partial.checklist)
      ? (partial.checklist as Record<string, boolean>)
      : null;
  const checklist = incomingChecklist
    ? { ...(base.checklist ?? {}), ...incomingChecklist }
    : { ...(base.checklist ?? {}) };
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
 * Validated through the same normalizer the options sheet and the request
 * planner use, so a remembered count can never be one the generator would
 * clamp behind the student's back.
 */
function sanitizeFlashcardGeneration(
  partial: Partial<FlashcardGenerationSettings>,
  base: FlashcardGenerationSettings
): FlashcardGenerationSettings {
  const merged = normalizeGenerationOptions({
    count: partial.count ?? base.count,
    typeMix: partial.typeMix ?? base.typeMix,
  });
  return { count: merged.count, typeMix: merged.typeMix };
}

/**
 * Both ids run through the shared allowlists, so a patch from a newer build —
 * or from a crafted request — narrows to a value Whisper actually accepts
 * instead of being stored and replayed on every later recording.
 */
function sanitizeLecture(
  partial: Partial<LectureSettings>,
  base: LectureSettings
): LectureSettings {
  return normalizeLectureSettings({
    spokenLanguage: partial.spokenLanguage ?? base.spokenLanguage,
    transcribeTo: partial.transcribeTo ?? base.transcribeTo,
    // Only ever set forward by the consent card; a patch that omits it keeps
    // whatever the account already answered.
    recordingConsent: partial.recordingConsent ?? base.recordingConsent,
  });
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
    // MONOTONIC: the visited flags are ORed with what is already stored, never
    // replaced. A client that is behind — an offline tab, an older build —
    // cannot send `{ library: false }` and un-tick a surface the student has
    // already opened on another device.
    onboardingVisited: p.onboardingVisited
      ? mergeOnboardingVisited(
          base.onboardingVisited ?? DEFAULT_USER_SETTINGS.onboardingVisited!,
          p.onboardingVisited
        )
      : base.onboardingVisited,
    flashcardGeneration: p.flashcardGeneration
      ? sanitizeFlashcardGeneration(
          p.flashcardGeneration,
          base.flashcardGeneration ?? DEFAULT_USER_SETTINGS.flashcardGeneration!
        )
      : base.flashcardGeneration,
    lecture: p.lecture
      ? sanitizeLecture(p.lecture, base.lecture ?? DEFAULT_USER_SETTINGS.lecture!)
      : base.lecture,
    // Scalar, allowlisted on the way in: an id from a newer build, a typo or a
    // smuggled object all resolve to `default` rather than reaching the prompt.
    tutorStyle:
      p.tutorStyle !== undefined ? normalizeTutorStyleId(p.tutorStyle) : base.tutorStyle,
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
    'onboardingVisited',
    'flashcardGeneration',
    'lecture',
  ];
  for (const key of categories) {
    const prevCat = previous[key];
    const nextCat = next[key];
    if (JSON.stringify(prevCat) !== JSON.stringify(nextCat) && nextCat != null) {
      (patch as Record<string, unknown>)[key] = nextCat;
    }
  }
  // The one scalar preference, compared by value rather than by JSON shape.
  if (next.tutorStyle != null && next.tutorStyle !== previous.tutorStyle) {
    patch.tutorStyle = next.tutorStyle;
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
      if (key === 'featureTips') {
        const lTips = lv as Partial<FeatureTipsSettings>;
        const rTips = rv as Partial<FeatureTipsSettings>;
        const mergedTips: Partial<FeatureTipsSettings> = { ...lTips, ...rTips };
        const lChecklist =
          lTips.checklist && typeof lTips.checklist === 'object' && !Array.isArray(lTips.checklist)
            ? lTips.checklist
            : {};
        const rChecklist =
          rTips.checklist && typeof rTips.checklist === 'object' && !Array.isArray(rTips.checklist)
            ? rTips.checklist
            : undefined;
        if (rChecklist) {
          mergedTips.checklist = { ...lChecklist, ...rChecklist };
        } else if (Object.keys(lChecklist).length > 0) {
          mergedTips.checklist = { ...lChecklist };
        }
        (out as Record<string, unknown>)[key] = mergedTips;
      } else {
        (out as Record<string, unknown>)[key] = { ...(lv as object), ...(rv as object) };
      }
    } else if (rv !== undefined) {
      (out as Record<string, unknown>)[key] = rv;
    } else if (lv !== undefined) {
      (out as Record<string, unknown>)[key] = lv;
    }
  }
  return out;
}

/**
 * Drop fields from `current` that match `sent` (same category key + value).
 * Retains edits that accumulated (or changed) after `sent` was snapshotted.
 */
export function subtractSettingsPatch(
  current: UserSettingsPatch | null | undefined,
  sent: UserSettingsPatch | null | undefined
): UserSettingsPatch {
  const cur = current && typeof current === 'object' ? current : {};
  const gone = sent && typeof sent === 'object' ? sent : {};
  const out: UserSettingsPatch = {};

  for (const key of Object.keys(cur) as Array<keyof UserSettingsPatch>) {
    const curVal = cur[key];
    const sentVal = gone[key];
    if (curVal === undefined) continue;

    if (
      curVal &&
      typeof curVal === 'object' &&
      !Array.isArray(curVal) &&
      sentVal &&
      typeof sentVal === 'object' &&
      !Array.isArray(sentVal)
    ) {
      if (key === 'featureTips') {
        const curTips = curVal as Partial<FeatureTipsSettings>;
        const sentTips = sentVal as Partial<FeatureTipsSettings>;
        const remainingTips: Partial<FeatureTipsSettings> = {};
        for (const tipKey of Object.keys(curTips) as Array<keyof FeatureTipsSettings>) {
          if (tipKey === 'checklist') {
            const curChecklist =
              curTips.checklist && typeof curTips.checklist === 'object'
                ? curTips.checklist
                : {};
            const sentChecklist =
              sentTips.checklist && typeof sentTips.checklist === 'object'
                ? sentTips.checklist
                : {};
            const remainingChecklist: Record<string, boolean> = {};
            for (const [ck, cv] of Object.entries(curChecklist)) {
              if (sentChecklist[ck] !== cv) remainingChecklist[ck] = cv;
            }
            if (Object.keys(remainingChecklist).length > 0) {
              remainingTips.checklist = remainingChecklist;
            }
            continue;
          }
          if (sentTips[tipKey] !== curTips[tipKey]) {
            (remainingTips as Record<string, unknown>)[tipKey] = curTips[tipKey];
          }
        }
        if (Object.keys(remainingTips).length > 0) {
          (out as Record<string, unknown>)[key] = remainingTips;
        }
        continue;
      }

      const remaining: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(curVal as Record<string, unknown>)) {
        if ((sentVal as Record<string, unknown>)[field] !== value) {
          remaining[field] = value;
        }
      }
      if (Object.keys(remaining).length > 0) {
        (out as Record<string, unknown>)[key] = remaining;
      }
    } else if (sentVal !== curVal) {
      (out as Record<string, unknown>)[key] = curVal;
    }
  }

  return out;
}

/**
 * After a successful settings sync: keep only mid-flight edits, re-apply them
 * onto the authoritative server payload.
 */
export function resolveSettingsAfterSync(args: {
  authoritative: UserSettings;
  pendingAfterSync: UserSettingsPatch | null | undefined;
  sentPending: UserSettingsPatch | null | undefined;
  lastSyncTime?: string;
}): {
  settings: UserSettings;
  pendingPatch: UserSettingsPatch;
  hasUnsyncedChanges: boolean;
} {
  const remaining = subtractSettingsPatch(args.pendingAfterSync, args.sentPending);
  const syncedAt = args.lastSyncTime ?? new Date().toISOString();
  const withSyncMeta: UserSettings = {
    ...args.authoritative,
    sync: {
      ...args.authoritative.sync,
      lastSyncTime: syncedAt,
    },
  };
  const hasUnsyncedChanges = Object.keys(remaining).length > 0;
  return {
    settings: hasUnsyncedChanges
      ? applySettingsPatch(withSyncMeta, remaining)
      : withSyncMeta,
    pendingPatch: remaining,
    hasUnsyncedChanges,
  };
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
