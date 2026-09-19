/**
 * Canonical user settings schema shared between web and mobile.
 */
import {
  DEFAULT_FLASHCARD_GENERATION_OPTIONS,
  type FlashcardTypeMix,
} from '../flashcards/generationOptions';
import {
  DEFAULT_TUTOR_STYLE_ID,
  normalizeTutorStyleId,
  type TutorStyleId,
} from '../ai/tutorStyles';
import {
  DEFAULT_LECTURE_SPOKEN_LANGUAGE,
  DEFAULT_LECTURE_TRANSCRIBE_TARGET,
  normalizeLectureSpokenLanguage,
  normalizeLectureTranscribeTarget,
  type LectureSpokenLanguageId,
  type LectureTranscribeTarget,
} from '../utils/lectureAudio';

export interface NotificationSettings {
  pushEnabled: boolean;
  dailyReminder: boolean;
  reminderTime: string;
  groupActivity: boolean;
  marketplaceUpdates: boolean;
  badgeUnlocks: boolean;
  srsReminders: boolean;
  /**
   * The exam countdown reminders (a week before, the day before, the morning
   * of). Defaults ON: a student who set an exam date has already asked to be
   * reminded about it, and a countdown that stays silent is the one failure
   * this feature cannot survive.
   */
  examReminders: boolean;
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
  /** Exam lock default for new test sessions: once answered, a question can't be revisited. */
  lockAnsweredQuestions: boolean;
}

/**
 * Low-data mode, in one sentence.
 *
 * The audit found it described two different ways one tap apart: Me said
 * "Skip images and heavy downloads on mobile data", Settings > Appearance said
 * "Lighter images, charts, and page loads". Two descriptions of one switch
 * read as two switches. This is the sentence; both surfaces import it.
 */
export const LOW_DATA_MODE_HINT = 'Skip images and heavy downloads to save data';

export interface AppearanceSettings {
  theme: 'light' | 'dark' | 'system';
  accentColor: string;
  fontSize: 'small' | 'medium' | 'large';
  compactMode: boolean;
  showAnimations: boolean;
  lowDataMode: boolean;
}

export interface PrivacySettings {
  /**
   * Full profile page visibility (RLS). Does not hide users from people search.
   * private = others cannot open the full profile; basic identity still appears in search
   * when discoverableForInvites is true. Cold DMs to private profiles become message requests.
   */
  profileVisibility: 'public' | 'groups' | 'private';
  /** When false, username does not appear in people/invite search (profile RLS unchanged). */
  discoverableForInvites: boolean;
  showOnlineStatus: boolean;
  showStudyActivity: boolean;
  /**
   * Cold-DM acceptance — does not affect search/discoverability.
   * everyone = open immediately; groups = open for shared groups else request;
   * none = message requests only (anyone may still attempt a first message).
   * Note: profileVisibility private also forces cold outreach into a message request.
   */
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

/**
 * Last-used flashcard generation options.
 *
 * Remembered because the options sheet is opened on the way to something else:
 * a student who always wants 30 mixed cards should not re-pick them every run.
 * Only the two choices that change the request live here — difficulty is a
 * per-run steer, not a preference.
 */
export interface FlashcardGenerationSettings {
  count: number;
  typeMix: FlashcardTypeMix;
}

/**
 * How the lecture recorder should transcribe.
 *
 * Account-wide rather than per-device: a student who lectures in Yoruba
 * lectures in Yoruba on the phone as well as the laptop. Both fields are read
 * through an allowlist on every read and every patch, so a stored value from a
 * newer build — or a smuggled object — resolves to the default rather than
 * reaching Whisper.
 *
 * `transcribeTo` has exactly two values on purpose: Whisper's translate task
 * translates into ENGLISH and nothing else, so there is no honest third option
 * to offer. See `whisperLanguageParam` / `needsWhisperTranslation` in
 * `utils/lectureAudio.ts`.
 */
export interface LectureSettings {
  spokenLanguage: LectureSpokenLanguageId;
  transcribeTo: LectureTranscribeTarget;
  /**
   * The student has answered the recording-consent card with "Yes, record now".
   *
   * Account-wide, like the languages, and for the same reason: a student who
   * has confirmed once that they may record their own classes should not be
   * asked again before every lecture on every device. It records that the
   * ANSWER was given — it does not record consent on anyone else's behalf, and
   * the consent line is still shown beside the pre-check.
   */
  recordingConsent?: boolean;
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

/**
 * "Has ever opened this surface", for the Home getting-started checklist.
 *
 * Three booleans and nothing else. They belong to the ACCOUNT, not the device:
 * a student who opened their Library on their phone should not be told to go
 * and open it again on a laptop (#68). They are MONOTONIC — false → true only
 * — so every merge in the app ORs rather than replaces, and an offline client
 * that has not read the profile yet cannot un-tick what another device ticked.
 */
export interface OnboardingVisitedSettings {
  library: boolean;
  marketplace: boolean;
  offline: boolean;
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
  onboardingVisited?: OnboardingVisitedSettings;
  flashcardGeneration?: FlashcardGenerationSettings;
  lecture?: LectureSettings;
  /**
   * Which tutor style the companion answers in by default.
   *
   * A SCALAR at the top level rather than a category, because there is exactly
   * one choice and no sub-keys — which also means an unknown value cannot smuggle
   * anything: it is run through `normalizeTutorStyleId` (a four-id allowlist) on
   * every read and every patch, and anything else becomes `default`.
   *
   * Non-privileged and account-wide: it is a preference about tone, so the
   * phone and the laptop should agree, and a request may still override it for
   * one turn without persisting.
   */
  tutorStyle?: TutorStyleId;
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
    examReminders: true,
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
    lockAnsweredQuestions: false,
  },
  appearance: {
    theme: 'light',
    // Byte-identical to DEFAULT_ACCENT_COLOR (the ink) and ACCENT_PRESETS[0].
    // Inlined to keep this module free of an appearanceEffects import cycle.
    accentColor: '#191919',
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
  onboardingVisited: {
    library: false,
    marketplace: false,
    offline: false,
  },
  flashcardGeneration: {
    count: DEFAULT_FLASHCARD_GENERATION_OPTIONS.count,
    typeMix: DEFAULT_FLASHCARD_GENERATION_OPTIONS.typeMix,
  },
  lecture: {
    spokenLanguage: DEFAULT_LECTURE_SPOKEN_LANGUAGE,
    transcribeTo: DEFAULT_LECTURE_TRANSCRIBE_TARGET,
  },
  tutorStyle: DEFAULT_TUTOR_STYLE_ID,
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
  // Same treatment for the checklist's visited flags: the deep merge above
  // would have carried any junk sub-key straight through, and this blob is
  // written by clients.
  merged.onboardingVisited = normalizeOnboardingVisited(
    record.onboardingVisited ?? merged.onboardingVisited
  );
  // Same reason as the two above: the deep merge would have carried a stored
  // string of any shape through. Four ids or `default`, nothing else.
  // Same reason again: the deep merge would carry a stored language of any
  // shape straight through to the Whisper request. Allowlist on every read.
  merged.lecture = normalizeLectureSettings(record.lecture ?? merged.lecture);
  merged.tutorStyle = normalizeTutorStyleId(record.tutorStyle ?? merged.tutorStyle);
  return merged;
}

/**
 * Exactly three booleans, whatever came in. Unknown sub-keys are dropped
 * rather than merged, so this key cannot be used to smuggle anything into the
 * settings blob.
 */
/** Two allowlisted ids, whatever came in. Unknown sub-keys are dropped. */
export function normalizeLectureSettings(raw: unknown): LectureSettings {
  const record =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    spokenLanguage: normalizeLectureSpokenLanguage(record.spokenLanguage),
    transcribeTo: normalizeLectureTranscribeTarget(record.transcribeTo),
    // Present only once the student has answered, so an account that never
    // opened the recorder keeps the two-key shape this category has always
    // written — which is what the API's sanitizer test pins.
    ...(record.recordingConsent === true ? { recordingConsent: true } : {}),
  };
}

export function normalizeOnboardingVisited(raw: unknown): OnboardingVisitedSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { library: false, marketplace: false, offline: false };
  }
  const record = raw as Record<string, unknown>;
  return {
    library: record.library === true,
    marketplace: record.marketplace === true,
    offline: record.offline === true,
  };
}

/**
 * OR two sets of visited flags. The ONE merge rule for this key: a flag that
 * is true anywhere stays true, so neither the device nor the profile can
 * un-tick the other, in whichever order they arrive.
 */
export function mergeOnboardingVisited(
  a: unknown,
  b: unknown
): OnboardingVisitedSettings {
  const left = normalizeOnboardingVisited(a);
  const right = normalizeOnboardingVisited(b);
  return {
    library: left.library || right.library,
    marketplace: left.marketplace || right.marketplace,
    offline: left.offline || right.offline,
  };
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
