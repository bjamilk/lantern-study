/**
 * Canonical user settings schema shared between web and mobile.
 */

export interface NotificationSettings {
  pushEnabled: boolean;
  dailyReminder: boolean;
  reminderTime: string;
  groupActivity: boolean;
  marketplaceUpdates: boolean;
  badgeUnlocks: boolean;
  srsReminders: boolean;
  testResults: boolean;
  emailEnabled: boolean;
  weeklyDigest: boolean;
  groupInvites: boolean;
}

export interface StudySettings {
  dailyCardGoal: number;
  dailyTestGoal: number;
  srsNewCardsPerDay: number;
  srsEasyBonus: number;
  srsIntervalModifier: number;
  srsMaxInterval: number;
  defaultTestMode: 'study' | 'exam';
  showExplanationsImmediately: boolean;
  autoAdvanceDelay: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  autoPlayAudio: boolean;
  showCardProgress: boolean;
}

export interface AppearanceSettings {
  theme: 'light' | 'dark' | 'system';
  accentColor: string;
  fontSize: 'small' | 'medium' | 'large';
  compactMode: boolean;
  showAnimations: boolean;
  lowDataMode: boolean;
}

export interface PrivacySettings {
  profileVisibility: 'public' | 'groups' | 'private';
  /** When false, username does not appear in invite/member search (profile RLS unchanged). */
  discoverableForInvites: boolean;
  showOnlineStatus: boolean;
  showStudyActivity: boolean;
  allowDirectMessages: 'everyone' | 'groups' | 'none';
}

export interface AccessibilitySettings {
  reduceMotion: boolean;
  highContrast: boolean;
  screenReaderOptimized: boolean;
  hapticFeedback: boolean;
}

export interface SyncSettings {
  autoSync: boolean;
  syncOnWifiOnly: boolean;
  lastSyncTime: string | null;
  syncConflictResolution: 'local' | 'remote' | 'ask';
}

export interface MarketplaceSettings {
  country_code: string;
  campus_id?: string | null;
  /** Free-text city when campus is "Other (city in Nigeria)". */
  campus_other?: string | null;
}

/** First-time / returning-user coach tips + getting-started checklist progress. */
export interface FeatureTipsSettings {
  version: number;
  dismissed: Record<string, boolean>;
  skippedAll?: boolean;
  dontShowAgain?: boolean;
  checklistDismissed?: boolean;
  checklist?: Record<string, boolean>;
}

export interface UserSettings {
  notifications: NotificationSettings;
  study: StudySettings;
  appearance: AppearanceSettings;
  privacy: PrivacySettings;
  accessibility: AccessibilitySettings;
  sync: SyncSettings;
  marketplace?: MarketplaceSettings;
  featureTips?: FeatureTipsSettings;
  version: number;
  updatedAt: string;
}

/** Legacy flat notification keys stored on web profiles before nested schema. */
export interface LegacyFlatNotificationSettings {
  dailyReminder?: boolean;
  groupActivity?: boolean;
  marketplaceUpdates?: boolean;
  badgeUnlocks?: boolean;
  srsReminders?: boolean;
  testResults?: boolean;
  theme?: 'light' | 'dark';
  lastReminderTimestamp?: number;
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  notifications: {
    pushEnabled: true,
    dailyReminder: true,
    reminderTime: '20:00',
    groupActivity: true,
    marketplaceUpdates: true,
    badgeUnlocks: true,
    srsReminders: true,
    testResults: true,
    emailEnabled: true,
    weeklyDigest: true,
    groupInvites: true,
  },
  study: {
    dailyCardGoal: 20,
    dailyTestGoal: 1,
    srsNewCardsPerDay: 10,
    srsEasyBonus: 1.3,
    srsIntervalModifier: 100,
    srsMaxInterval: 365,
    defaultTestMode: 'study',
    showExplanationsImmediately: true,
    autoAdvanceDelay: 0,
    shuffleQuestions: true,
    shuffleOptions: true,
    autoPlayAudio: false,
    showCardProgress: true,
  },
  appearance: {
    theme: 'light',
    accentColor: '#6366f1',
    fontSize: 'medium',
    compactMode: false,
    showAnimations: true,
    lowDataMode: false,
  },
  privacy: {
    profileVisibility: 'public',
    discoverableForInvites: true,
    showOnlineStatus: true,
    showStudyActivity: true,
    allowDirectMessages: 'groups',
  },
  accessibility: {
    reduceMotion: false,
    highContrast: false,
    screenReaderOptimized: false,
    hapticFeedback: true,
  },
  sync: {
    autoSync: true,
    syncOnWifiOnly: false,
    lastSyncTime: null,
    syncConflictResolution: 'remote',
  },
  marketplace: {
    country_code: 'NG',
    campus_id: null,
    campus_other: null,
  },
  featureTips: {
    version: 2,
    dismissed: {},
    skippedAll: false,
    dontShowAgain: false,
    checklistDismissed: false,
    checklist: {},
  },
  version: 1,
  updatedAt: new Date().toISOString(),
};

function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key in source) {
    const value = source[key as keyof T];
    if (value === undefined) continue;
    const existing = target[key as keyof T];
    if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      typeof existing === 'object' &&
      existing !== null &&
      !Array.isArray(existing)
    ) {
      (result as Record<string, unknown>)[key] = deepMerge(
        existing as object,
        value as object
      );
    } else {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}

/** Normalize raw profile.settings (flat legacy or nested) into UserSettings. */
export function normalizeUserSettings(raw: unknown): UserSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_USER_SETTINGS, updatedAt: new Date().toISOString() };
  }

  const record = raw as Record<string, unknown>;

  let merged: UserSettings;
  if (record.notifications && typeof record.notifications === 'object') {
    merged = deepMerge(DEFAULT_USER_SETTINGS, record as Partial<UserSettings>);
  } else {
    const legacy = record as LegacyFlatNotificationSettings & {
      privacy?: Partial<PrivacySettings>;
      study?: Partial<StudySettings>;
      appearance?: Partial<AppearanceSettings>;
      accessibility?: Partial<AccessibilitySettings>;
      sync?: Partial<SyncSettings>;
      featureTips?: Partial<FeatureTipsSettings>;
    };

    merged = deepMerge(DEFAULT_USER_SETTINGS, {
      notifications: {
        ...(legacy.dailyReminder !== undefined ? { dailyReminder: legacy.dailyReminder } : {}),
        ...(legacy.groupActivity !== undefined ? { groupActivity: legacy.groupActivity } : {}),
        ...(legacy.marketplaceUpdates !== undefined ? { marketplaceUpdates: legacy.marketplaceUpdates } : {}),
        ...(legacy.badgeUnlocks !== undefined ? { badgeUnlocks: legacy.badgeUnlocks } : {}),
        ...(legacy.srsReminders !== undefined ? { srsReminders: legacy.srsReminders } : {}),
        ...(legacy.testResults !== undefined ? { testResults: legacy.testResults } : {}),
      },
      ...(legacy.theme ? { appearance: { theme: legacy.theme } } : {}),
      ...(legacy.privacy ? { privacy: legacy.privacy as Partial<PrivacySettings> } : {}),
      ...(legacy.study ? { study: legacy.study as Partial<StudySettings> } : {}),
      ...(legacy.accessibility ? { accessibility: legacy.accessibility as Partial<AccessibilitySettings> } : {}),
      ...(legacy.sync ? { sync: legacy.sync as Partial<SyncSettings> } : {}),
      ...(legacy.featureTips ? { featureTips: legacy.featureTips as FeatureTipsSettings } : {}),
    } as Partial<UserSettings>);
  }

  // Normalize feature tips shape (version bump, dismissed map, checklist).
  const tipsRaw = (record.featureTips ?? merged.featureTips) as unknown;
  merged.featureTips = normalizeFeatureTipsSettings(tipsRaw);
  return merged;
}

function normalizeFeatureTipsSettings(raw: unknown): FeatureTipsSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_USER_SETTINGS.featureTips! };
  }
  const record = raw as Record<string, unknown>;
  const checklist =
    record.checklist && typeof record.checklist === 'object' && !Array.isArray(record.checklist)
      ? (record.checklist as Record<string, boolean>)
      : {};
  // Got-it dismissals are session-only — never keep them on the profile settings blob.
  return {
    version: 2,
    dismissed: {},
    skippedAll: Boolean(record.skippedAll),
    dontShowAgain: Boolean(record.dontShowAgain),
    checklistDismissed: Boolean(record.checklistDismissed),
    checklist,
  };
}

export function getNotificationSettings(settings: UserSettings): NotificationSettings {
  return settings.notifications;
}

export function mergeSettingsCategory<K extends keyof UserSettings>(
  current: UserSettings,
  category: K,
  updates: Partial<UserSettings[K]>
): UserSettings {
  const categoryValue = current[category];
  const mergedCategory =
    typeof categoryValue === 'object' && categoryValue !== null
      ? { ...(categoryValue as object), ...(updates as object) }
      : updates;

  return {
    ...current,
    [category]: mergedCategory as UserSettings[K],
    updatedAt: new Date().toISOString(),
  };
}

export function formatReminderTime(timeString: string): string {
  const [hoursStr, minutesStr] = timeString.split(':');
  const hours = parseInt(hoursStr || '0', 10);
  const minutes = parseInt(minutesStr || '0', 10);
  const period = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  return `${hour12}:${minutes.toString().padStart(2, '0')} ${period}`;
}

export const SETTINGS_FAQ = [
  {
    q: 'How do flashcard reviews work?',
    a: 'Open a deck and tap Review. Rate each card Again, Hard, Good, or Easy — Lantern Study schedules the next review using spaced repetition.',
  },
  {
    q: 'How do group tests and study sessions work?',
    a: 'In a group chat, tap Test or Study to pick question types, tags, and how many questions to include. Shared questions from the group become your session.',
  },
  {
    q: 'What is the difference between JSON and CSV export?',
    a: 'JSON is a full deck backup including images, card types, and SRS progress. CSV is front/back text only for spreadsheets.',
  },
  {
    q: 'How do duel challenges work?',
    a: 'Challenge a group member from the group menu or Challenges inbox. When they accept, both players answer the same questions and results appear when finished.',
  },
  {
    q: 'Can I use Lantern Study offline?',
    a: 'Download decks and bundles from Offline Mode. Changes sync automatically when you reconnect.',
  },
] as const;
