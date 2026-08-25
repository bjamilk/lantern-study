import { ExpoConfig, ConfigContext } from 'expo/config';

const APP_VARIANT = process.env.APP_VARIANT || process.env.EAS_BUILD_PROFILE || 'development';
const IS_DEV_VARIANT = APP_VARIANT === 'development';
const IS_PRODUCTION_BUILD = ['production', 'preview'].includes(process.env.EAS_BUILD_PROFILE || '');
const ANDROID_PACKAGE = IS_DEV_VARIANT ? 'com.lanternstudy.app.dev' : 'com.lanternstudy.app';
const IOS_BUNDLE_ID = IS_DEV_VARIANT ? 'com.lanternstudy.app.dev' : 'com.lanternstudy.app';

/** Public cloud defaults — baked into preview/production `extra` so OTA never ships empty endpoints. */
const PRODUCTION_ENDPOINTS = {
  supabaseUrl: 'https://tiizkjhbrnaibaagmurl.supabase.co',
  supabaseAnonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpaXpramhicm5haWJhYWdtdXJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NjMyMjMsImV4cCI6MjA5NjQzOTIyM30.dzI3L5Blbao5DItW3xgMIUzAi9LBijZncFaNBLTMvoE',
  apiUrl: 'https://lantern-study-api.onrender.com',
} as const;

function resolvePublicEndpoint(
  envValue: string | undefined,
  productionDefault: string
): string | undefined {
  if (envValue && envValue.length > 0) return envValue;
  if (IS_PRODUCTION_BUILD) return productionDefault;
  return undefined;
}

if (IS_PRODUCTION_BUILD) {
  const required = ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_API_URL'] as const;
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    // Soft-warn only: production defaults below keep OTA/export usable when EAS env lags.
    console.warn(
      `[app.config] Missing Expo env for ${process.env.EAS_BUILD_PROFILE}: ${missing.join(', ')}. Using production defaults.`
    );
  }
}

const SPLASH_BACKGROUND_COLOR = '#6569EE';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: IS_DEV_VARIANT ? 'Lantern Study Dev' : 'Lantern Study',
  slug: 'lantern-study',
  // This field is also the OTA runtime fence (runtimeVersion.policy: appVersion):
  // updates only reach binaries built from the same version. 1.0.2 binaries pair
  // with the pre-Reanimated-3 channel state and must never receive JS from here.
  // 1.0.6: Smart Notes guidance + depth presets, AI credit costs surfaced in
  // the UI, and XP that tracks real study work.
  // 1.0.7: the app no longer rebuilds itself on every foreground (which reset
  // navigation to Home and made the record button look like it ejected you from
  // a note), stale notification/deck state now refreshes, chat is reachable from
  // marketplace DMs, and bottom sheets clear the system navigation bar.
  // 1.0.8: the budget is a plan, not just a cap — expected income and planned
  // savings, a live "left to allocate", and spend measured against the calendar.
  // The monthly limit finally syncs with the web (its API route did not exist).
  // 1.0.9: photo notes are read by OCR — text is pulled off photographs
  // automatically and feeds Smart Notes, flashcards and quizzes like any
  // other note.
  // 1.0.10: browse previous months in the budget, and a budget no longer leaks
  // into the month after the one it was set for.
  // 1.0.11: deck exports share a real .json/.csv file instead of pasting the
  // whole deck into a chat as message text (adds expo-sharing — native build).
  // 1.0.12: the applicant CSV and the account data export share real files too,
  // and a sharing failure no longer reports itself as an export rate limit.
  // 1.0.13: budget plans are stored per month, so browsing history shows what
  // you had planned as well as what you spent.
  // 1.0.14: the sign-in screen drops the demo-mode button, which could never
  // enter the app (its placeholder session was rejected on every request), and
  // Google sign-in now carries the real Google mark and wordmark.
  // 1.0.15: PDFs and slides in a note open fullscreen for reading, and close
  // back to the note — the old "full screen" handed the file to an external
  // browser and left the app.
  // 1.0.16: shared lanternstudy.com links open in the app — deep linking
  // pointed at lanternstudy.app, a domain that does not exist, so the app's own
  // allowlist rejected every link it generated. Also drops two Android
  // permissions the app never used.
  // 1.0.17: crash reporting goes live — release builds carry the Sentry DSN,
  // so Android crashes stop being invisible (previously observable only over
  // adb logcat on a connected device).
  // 1.0.18: marketplace question banks — buy/download study bundles that land
  // in Offline Mode, publish and update banks from the app, per-bank
  // leaderboards with durable offline score sync, and sessions on other
  // devices are revoked when the password changes.
  // 1.0.19: purchased question banks opened with an empty stem and no options.
  // Offline bundles are shared web/mobile storage holding two question shapes;
  // the cloud path cast instead of converting.
  // 1.0.20: matching questions in offline bundles are playable again (their
  // pair structures were dropped in storage), fill-in-blank answers grade
  // correctly, and diagram labels survive the round trip.
  // 1.0.21: the group chat's test setup can save the selection as an offline
  // bundle ("Download for offline"), matching the web — previously the only
  // path on mobile was buried in More -> Offline mode.
  // 1.0.22: picking a font size no longer dumps you on Home (navigation state
  // survives the remount that applies the scale), the Offline screen's bottom
  // buttons clear the system navigation bar, and test setup preselects all
  // question types like the web.
  // 1.0.23: changing the font size no longer flashes the boot screen and
  // dumps you on Home — the remount that applies the scale re-armed the boot
  // gate, and the navigator mounting late discarded the restored navigation
  // state. It also no longer re-fetches every store on each font change.
  // 1.0.24: swipe-to-grade works. Swiping a flashcard to rate it crashed the
  // app outright — the gesture ran two ordinary functions on the UI thread,
  // where they are not callable — so grading was button-only since launch.
  // 1.0.25: the AI credit counter starts from the new 20-request daily
  // allowance instead of a stale 100 — the server cut the limit and the app
  // had the old number baked in as its pre-response default.
  // 1.0.26: a big marketplace + study release. JOBS: browse now has the full
  // filter set (all job types, pay, compensation, location, sort — the minPay
  // filter and 'closing soon' sort were unreachable before); employers get
  // logo/company/member tools and can read applicants' screening answers;
  // deleting a note asks first; the Quiz button's quiz now actually opens on
  // your dashboard; template placeholders can't be posted as real jobs; a
  // passed deadline closes applications; and Pay now / View order reach the
  // order an accepted offer created. MARKETPLACE: sold-out and expired states
  // are honest, editing a listing no longer wipes its sale end date, bundle
  // creation works, and item condition is filterable. STUDY: flashcard review
  // gains an interval preview on each grade button, undo-last-grade, and an
  // end-of-session summary; a lapsed card no longer silently drops out of the
  // review queue; imported study material is actually saved (not just counted);
  // and note previews read as clean text instead of raw markdown.
  // 1.0.27: the per-test "Lock answered questions" exam toggle now works for
  // group question-bank tests — the group launch path (startQuestionSet) dropped
  // the toggle and only ever read the global Settings default, so the modal
  // switch silently did nothing on the main way people start tests.
  // 1.0.28: Lantern AI chat gains the assistant's action chips, feedback
  // thumbs, and formatted replies (bold/bullets/numbered steps) — all
  // previously web-only. Offline bundles can be taken as untimed Study
  // sessions next to scored Tests, and the offline screen lists every group
  // (the old first-5 cap hid the rest with no hint). Sync is sturdier: a dead
  // connection no longer burns an operation's retries or strands work in a
  // queue nothing drained, reviewing the same flashcard twice offline now
  // counts both reviews, and "Sync Results" reports what actually happened.
  // 1.0.29: course topics — the syllabus level between a course and your work.
  // Notes, decks and tests can be filed under a topic as well as a course, the
  // Library gains topic as a third level under each course, and an outline can
  // be built from the flashcard tags you already use. Topics are shared with
  // everyone taking the course, so renaming or deleting one changes it for them
  // too — deleting only unfiles work, it never deletes anyone's notes or decks.
  version: '1.0.29',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  // Legacy Architecture. Reanimated 4 / react-native-worklets require the New
  // Architecture, but Hermes + New Arch segfaults this app on Android at boot
  // (SIGSEGV in RuntimeScheduler_Modern::performMicrotaskCheckpoint), so the app runs
  // Reanimated 3 on the Legacy Architecture. Declared here — not just in
  // android/gradle.properties — because `android/` is gitignored and regenerated by
  // `expo prebuild`, which would otherwise reset newArchEnabled to true.
  newArchEnabled: false,

  // Deep linking configuration
  scheme: 'lanternstudy',

  splash: {
    image: './assets/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: SPLASH_BACKGROUND_COLOR,
  },

  ios: {
    supportsTablet: true,
    bundleIdentifier: IOS_BUNDLE_ID,
    associatedDomains: ['applinks:lanternstudy.com'],
    // Background lecture mic requires a new native build (not OTA-only).
    infoPlist: {
      UIBackgroundModes: ['audio'],
      NSMicrophoneUsageDescription:
        'Lantern Study needs the microphone to record lectures and transcribe them into notes.',
      // iOS terminates the app immediately — no JS error, no permission prompt —
      // if the photo library or camera is opened without these strings. Eleven
      // screens use expo-image-picker (flashcard images, note photos, avatars,
      // marketplace listings), so every one of them crashed on iOS without them.
      NSPhotoLibraryUsageDescription:
        'Lantern Study needs your photo library so you can add images to flashcards, notes and listings.',
      NSPhotoLibraryAddUsageDescription:
        'Lantern Study saves images you export back to your photo library.',
      NSCameraUsageDescription:
        'Lantern Study needs the camera so you can photograph notes and add pictures to cards.',
    },
  },

  android: {
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: SPLASH_BACKGROUND_COLOR,
    },
    package: ANDROID_PACKAGE,
    permissions: ['RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS'],
    // Both arrive through dependency manifests, not from this app.
    // SYSTEM_ALERT_WINDOW comes from react-native's *debug* manifest and was
    // reaching release builds — "display over other apps" is a permission Play
    // scrutinises and nothing here draws overlays. WRITE_EXTERNAL_STORAGE has
    // been inert since scoped storage (API 29); uploads and exports go through
    // the app's own directories and the share sheet.
    blockedPermissions: [
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ],
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [
          {
            scheme: 'https',
            host: 'lanternstudy.com',
            pathPrefix: '/',
          },
          {
            scheme: 'lanternstudy',
          },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },

  web: {
    bundler: 'metro',
    favicon: './assets/favicon.png',
  },

  plugins: [
    // Keeps the fmt C++17 workaround in the generated Podfile — see the plugin.
    './plugins/withFmtCxx17',
    // Bounds READ_EXTERNAL_STORAGE to API <= 32 — see the plugin.
    './plugins/withScopedStoragePermission',
    'expo-font',
    'expo-secure-store',
    'expo-web-browser',
    'expo-av',
    ['expo-apple-authentication', { usesAppleSignIn: true }],
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 260,
        resizeMode: 'contain',
        backgroundColor: SPLASH_BACKGROUND_COLOR,
      },
    ],
  ],

  updates: {
    url: 'https://u.expo.dev/2e6076dd-b213-42d0-a966-3a15e3f9cb33',
    // Preview/production binaries must keep OTA enabled. Dev clients stay off.
    enabled: IS_PRODUCTION_BUILD,
    checkAutomatically: 'ON_LOAD',
    // Don't block boot; JS `checkAndApplyOtaUpdate` reloads when a bundle is ready.
    // Note: changing this only affects new native builds; installed APKs keep prior value.
    fallbackToCacheTimeout: 0,
  },

  runtimeVersion: {
    policy: 'appVersion',
  },

  extra: {
    appVariant: APP_VARIANT,
    lanApiHost: process.env.EXPO_PUBLIC_LAN_API_HOST || '127.0.0.1',
    emulatorApiHost: process.env.EXPO_PUBLIC_EMULATOR_API_HOST || '10.0.2.2',
    supabaseUrl: resolvePublicEndpoint(
      process.env.EXPO_PUBLIC_SUPABASE_URL,
      PRODUCTION_ENDPOINTS.supabaseUrl
    ),
    supabaseAnonKey: resolvePublicEndpoint(
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      PRODUCTION_ENDPOINTS.supabaseAnonKey
    ),
    apiUrl: resolvePublicEndpoint(process.env.EXPO_PUBLIC_API_URL, PRODUCTION_ENDPOINTS.apiUrl),
    eas: {
      projectId: '2e6076dd-b213-42d0-a966-3a15e3f9cb33',
    },
  },

  experiments: {
    typedRoutes: true,
  },
});
