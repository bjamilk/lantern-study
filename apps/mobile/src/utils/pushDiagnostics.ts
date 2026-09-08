/**
 * Why a notification did or did not arrive, in words a student can act on.
 *
 * Build 161 finished a quiz while the app was backgrounded and NO push was
 * ever delivered; the only notice the student got was the LOCAL one the app
 * posts on resume. The server already knew what happened — it writes a push
 * audit onto the job record, and it can say whether this account has a usable
 * token — but nothing in the app read either, so a missing push could not be
 * diagnosed from the device at all.
 *
 * This module is the whole vocabulary: it turns the server's machine words
 * (`no_token`, `prefs_off`, …) into plain ones, and folds the four things
 * that have to be true for a push to land into a single verdict the progress
 * sheet and the settings screen both read. Pure — no imports beyond types, so
 * it is unit-tested in node.
 */
import type { JobPushAudit, JobPushSkipReason } from '../stores/jobsCore';

/**
 * The server's skip reasons, in plain words.
 *
 * Each one names a real, fixable condition; a raw code is never shown. The
 * phrasing is a sentence fragment on purpose — it is completed by "Push
 * skipped: …" so the caption reads as one thought.
 */
export const PUSH_SKIP_REASON_COPY: Record<JobPushSkipReason, string> = {
  disabled: 'push is off on the server',
  no_owner: "we couldn't tell whose job this was",
  no_token: 'no push token on this device',
  prefs_off: 'notifications are off in Settings',
  not_pushable: "this kind doesn't notify",
  claimed: 'already sent',
  error: 'push failed',
};

/** What the sheet says when the server did send one. */
export const PUSH_SENT_COPY = 'Notified by push ✓';

/**
 * The ONE thing a student is told when a push did not go out.
 *
 * Build 168 showed a finished job's sheet reading "Push failed: Could not find
 * APNs credentials for com.lanternstudy.app.dev (@bjamilk/lantern-study). You
 * may need to generate or upload new push credentials." That is a message to
 * whoever ships the app, shown to someone revising for an exam, and it reads
 * like their work went missing. Two facts are all that belong here: the
 * notification did not arrive, and the work is safe.
 *
 * The raw text is not deleted — `jobPushFailureDetail` still returns it, for
 * the Me → Notifications diagnostics panel and for a bug report.
 */
export const PUSH_FAILED_STUDENT_COPY =
  'We could not send a notification to this phone. Your work is saved here.';

/**
 * The push failures we can actually tell apart.
 *
 * Every one of them produces the SAME student sentence — none of them is
 * something a student can fix from a job sheet. The kind exists so the
 * diagnostics panel (and a support screenshot) can name the real cause.
 */
export type PushFailureKind =
  | 'apns-credentials'
  | 'fcm-credentials'
  | 'device-not-registered'
  | 'invalid-credentials'
  | 'rate-limited'
  | 'unknown';

/**
 * What each kind means to the person holding the phone.
 *
 * One sentence, no build words: which of these is true changes what they can
 * do about it, and nothing else here does. `PUSH_FAILURE_KIND_COPY` keeps the
 * build-facing sentence for the disclosure.
 */
export const PUSH_FAILURE_KIND_PLAIN_COPY: Record<PushFailureKind, string> = {
  'apns-credentials': 'Notifications are not set up for this build yet.',
  'fcm-credentials': 'Notifications are not set up for this build yet.',
  'invalid-credentials': 'Notifications are not set up for this build yet.',
  'device-not-registered': 'This phone needs to register for notifications again.',
  'rate-limited': 'Too many notifications at once — this one was dropped.',
  unknown: 'The notification service would not take it.',
};

/** What each kind means, for the diagnostics panel only. */
export const PUSH_FAILURE_KIND_COPY: Record<PushFailureKind, string> = {
  'apns-credentials': 'No Apple push credentials are uploaded for this build.',
  // The Android twin of the APNs case: a build with no google-services / FCM
  // key, or one where Firebase was never initialised, is not set up for push.
  'fcm-credentials': 'Android push (FCM) is not configured for this build.',
  'device-not-registered': 'This phone\u2019s push token is no longer valid — re-register it.',
  'invalid-credentials': 'The push credentials for this build were rejected.',
  'rate-limited': 'Expo was sending too fast and dropped this one.',
  unknown: 'Expo rejected the notification.',
};

/**
 * Classify an Expo push error by the shapes Expo actually returns.
 *
 * Expo puts its machine code in `message` for ticket errors and in prose for
 * credential failures, so both are matched on substrings, case-insensitively.
 * An unrecognised message is `unknown` rather than a guess.
 */
export const classifyPushFailure = (
  raw: string | null | undefined
): PushFailureKind => {
  const text = (raw ?? '').toLowerCase();
  if (!text.trim()) return 'unknown';
  // Android's "not configured" shapes: a missing google-services / FCM key, or
  // Firebase never initialised in this build. Checked BEFORE the APNs branch so
  // the FCM guide URL Expo returns (…/push-notifications/fcm-credentials/) is
  // read as an Android problem, not mistaken for an Apple one.
  if (text.includes('firebase') || text.includes('fcm')) {
    return 'fcm-credentials';
  }
  if (text.includes('apns') || text.includes('push credentials')) {
    return 'apns-credentials';
  }
  if (text.includes('devicenotregistered')) return 'device-not-registered';
  if (text.includes('invalidcredentials')) return 'invalid-credentials';
  if (text.includes('messagerateexceeded') || text.includes('rate exceeded')) {
    return 'rate-limited';
  }
  return 'unknown';
};

/** Every ticket Expo rejected, as one message. */
const ticketError = (audit: JobPushAudit): string | undefined => {
  const failed = (audit.expoTickets ?? []).filter((t) => t.status === 'error');
  if (failed.length === 0) return undefined;
  return failed.map((t) => t.message).find((m) => typeof m === 'string' && m.length > 0)
    ?? 'Expo rejected it';
};

/**
 * One caption line about this job's push, or nothing.
 *
 * `null` when the record carries no audit: an older server, or a job that has
 * not settled yet. Silence is the honest answer there — inventing "we told
 * you" or "we didn't" from an absent field is the failure this exists to fix.
 */
export const describeJobPush = (audit: JobPushAudit | null | undefined): string | null => {
  if (!audit || typeof audit.attemptedAt !== 'string') return null;

  if (audit.skippedReason === 'error') return PUSH_FAILED_STUDENT_COPY;
  if (audit.skippedReason) {
    return `Push skipped: ${PUSH_SKIP_REASON_COPY[audit.skippedReason] ?? audit.skippedReason}`;
  }

  // No skip reason: the server tried. Expo can still have rejected it, and a
  // rejected ticket is not a delivery.
  if (ticketError(audit)) return PUSH_FAILED_STUDENT_COPY;
  if (audit.tokenCount === 0) {
    return `Push skipped: ${PUSH_SKIP_REASON_COPY.no_token}`;
  }
  return PUSH_SENT_COPY;
};

/**
 * The raw failure text, for the diagnostics panel and nothing else.
 *
 * `null` when this job's push did not fail. Never rendered on a job sheet:
 * that is the defect this pair of functions exists to keep fixed.
 */
export const jobPushFailureDetail = (
  audit: JobPushAudit | null | undefined
): string | null => {
  if (!audit || typeof audit.attemptedAt !== 'string') return null;
  const raw = audit.skippedReason === 'error'
    ? (audit.error?.trim() || ticketError(audit))
    : ticketError(audit);
  return raw ?? null;
};

/**
 * One diagnostics row naming the real cause, with Expo's own words after it.
 *
 * Empty when nothing failed, so the panel can spread it unconditionally.
 */
export const jobPushFailureRows = (
  audit: JobPushAudit | null | undefined
): PushDiagnosticRow[] => {
  const raw = jobPushFailureDetail(audit);
  if (!raw) return [];
  const kind = classifyPushFailure(raw);
  return [
    {
      key: 'push-failure',
      label: 'Last notification failure',
      value: PUSH_FAILURE_KIND_PLAIN_COPY[kind],
      detail: `${PUSH_FAILURE_KIND_COPY[kind]} (${raw})`,
      state: 'bad',
    },
  ];
};

// ─────────────────────────────────────────────────────────────
// Can this device be told anything at all?
// ─────────────────────────────────────────────────────────────

/** The OS answer, plus the case where the module itself is missing (Expo Go). */
export type PushPermissionState = 'granted' | 'denied' | 'undetermined' | 'unavailable';

/** What the server says about this account, or `null` when it did not answer. */
export interface PushServerStatus {
  hasToken: boolean;
  /** The account's master switch. A token the server will never send to is not delivery. */
  pushEnabled: boolean;
  /** When the token was last registered. Absent for tokens older than the route. */
  updatedAt?: string | null;
}

export interface PushReadinessInput {
  /** Does this build have push at all? Expo Go does not. */
  supported: boolean;
  permission: PushPermissionState;
  /** A token this device obtained, if registration has run here. */
  deviceToken?: string | null;
  /** `null` when the status route could not be read (offline, old server). */
  server: PushServerStatus | null;
}

/**
 * Three answers, not two.
 *
 * `unknown` exists because "we could not ask the server" is not the same as
 * "notifications are off": telling a student their notifications are off when
 * the request merely failed sends them to a screen that is already correct.
 * The sheet keeps its promise on `unknown` and drops it only on `off`.
 */
export type PushReadiness = 'ready' | 'off' | 'unknown';

export const pushReadiness = (input: PushReadinessInput): PushReadiness => {
  if (!input.supported) return 'off';
  if (input.permission !== 'granted') return 'off';
  if (!input.server) return 'unknown';
  if (!input.server.hasToken) return 'off';
  if (!input.server.pushEnabled) return 'off';
  return 'ready';
};

/** One row of the diagnostics section. `state` drives the tick or cross. */
export interface PushDiagnosticRow {
  key:
    | 'support'
    | 'permission'
    | 'device-token'
    | 'server-token'
    | 'server-prefs'
    | 'app-identity'
    | 'device-token-type'
    | 'register-error'
    | 'push-failure';
  label: string;
  /** The plain half. Always safe to show a student. */
  value: string;
  /**
   * The build-facing half — an Expo message, an APNs credential string, an EAS
   * slug — kept ONLY for the "Show details" disclosure.
   *
   * Build 172 printed "No Apple push credentials are uploaded for this build.
   * (Could not find APNs credentials for com.lanternstudy.app.dev
   * (@bjamilk/lantern-study)…)" straight onto a student's settings screen, on
   * an Android phone. None of it is theirs to read or act on, and all of it is
   * needed in a bug report — so it moves behind a disclosure rather than being
   * deleted.
   */
  detail?: string;
  state: 'ok' | 'bad' | 'unknown';
}

const PERMISSION_COPY: Record<PushPermissionState, { value: string; state: 'ok' | 'bad' | 'unknown' }> = {
  granted: { value: 'Allowed', state: 'ok' },
  denied: { value: 'Blocked in system settings', state: 'bad' },
  // Covers both "never asked" and "denied, but we may ask again": the app
  // cannot tell a student which without asking, and both are fixed by the
  // same button.
  undetermined: { value: 'Not allowed yet', state: 'bad' },
  unavailable: { value: 'Not available in this build', state: 'bad' },
};

/**
 * The four facts, each stated separately.
 *
 * Separately on purpose: a single "notifications are off" cannot be acted on,
 * while "the OS allows it, this device has a token, the server has none" says
 * exactly which button to press.
 */
export const pushDiagnosticRows = (input: PushReadinessInput): PushDiagnosticRow[] => {
  const rows: PushDiagnosticRow[] = [];
  if (!input.supported) {
    rows.push({
      key: 'support',
      label: 'Push notifications',
      value: 'Not available in this build (Expo Go)',
      state: 'bad',
    });
    return rows;
  }
  const permission = PERMISSION_COPY[input.permission] ?? PERMISSION_COPY.undetermined;
  rows.push({
    key: 'permission',
    label: 'Permission on this phone',
    value: permission.value,
    state: permission.state,
  });
  rows.push({
    key: 'device-token',
    label: 'Push token on this device',
    value: input.deviceToken ? maskToken(input.deviceToken) : 'None yet',
    state: input.deviceToken ? 'ok' : 'unknown',
  });
  if (!input.server) {
    rows.push({
      key: 'server-token',
      label: 'Registered with the server',
      value: "Couldn't check right now",
      state: 'unknown',
    });
    return rows;
  }
  rows.push({
    key: 'server-token',
    label: 'Registered with the server',
    value: input.server.hasToken
      ? input.server.updatedAt
        ? `Yes — last registered ${formatStamp(input.server.updatedAt)}`
        : 'Yes'
      : 'No token on file',
    state: input.server.hasToken ? 'ok' : 'bad',
  });
  rows.push({
    key: 'server-prefs',
    label: 'Push allowed for your account',
    value: input.server.pushEnabled ? 'On' : 'Off in your settings',
    state: input.server.pushEnabled ? 'ok' : 'bad',
  });
  return rows;
};

/** The one sentence above the rows. Says what will happen, not what is broken. */
export const pushReadinessSummary = (input: PushReadinessInput): string => {
  switch (pushReadiness(input)) {
    case 'ready':
      return "This phone can be notified when work you started finishes, even if the app is closed.";
    case 'unknown':
      return "We couldn't check with the server just now. Notifications may still work — try again when you're online.";
    default:
      return 'No push notifications on this device — notifications about finished work will only appear when you reopen the app.';
  }
};

/** An Expo token, short enough to compare by eye and useless to anyone reading it. */
export const maskToken = (token: string): string => {
  const inner = token.replace(/^ExponentPushToken\[/, '').replace(/\]$/, '');
  if (inner.length <= 6) return `…${inner}`;
  return `…${inner.slice(-6)}`;
};

/** A timestamp as a date a person reads, or the raw string when it will not parse. */
export const formatStamp = (iso: string): string => {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms).toLocaleString();
};

/** What a "Re-register" press actually did. */
export interface PushRegisterOutcome {
  token: string | null;
  uploaded: boolean;
  /** Whatever failed, verbatim — never rewritten into a friendlier lie. */
  error?: string;
}

/**
 * The outcome, said plainly and without hedging.
 *
 * A failure keeps its own message: the point of this screen is that the
 * student (or whoever they send a screenshot to) can see the real reason.
 */
export const describeRegisterOutcome = (outcome: PushRegisterOutcome): string => {
  if (outcome.error) return `Failed: ${outcome.error}`;
  if (!outcome.token) {
    return 'No token. The OS refused, or this build has no push support — open system settings to allow notifications.';
  }
  if (!outcome.uploaded) {
    return `Got a token (${maskToken(outcome.token)}) but couldn't hand it to the server. Check your connection and try again.`;
  }
  return `Registered ${maskToken(outcome.token)} with the server.`;
};

/**
 * The same outcome, split the way every other row on this panel is split.
 *
 * `describeRegisterOutcome` returns one string that begins "Failed: " and then
 * pastes the OS/Expo sentence straight after it — which is how the panel came
 * to print "Failed: Make sure to complete the guide at https://docs.expo.dev/…
 * Default FirebaseApp is not initialized in this process com.lanternstudy.app"
 * at a student who had only pressed "Re-register this device". The verbatim
 * text is not deleted: it moves behind the panel's existing "Show details"
 * disclosure, where a bug report can still reach it. `describeRegisterOutcome`
 * is left alone for callers that want the single joined string.
 */
export interface PushRegisterOutcomeParts {
  /** The half a student reads. Never carries a URL, a build id or a handle. */
  value: string;
  /** The build-facing half, for the disclosure only. */
  detail?: string;
}

export const registerOutcomeParts = (
  outcome: PushRegisterOutcome
): PushRegisterOutcomeParts => {
  if (outcome.error) {
    const kind = classifyPushFailure(outcome.error);
    return {
      value:
        kind === 'unknown'
          ? 'This phone could not get a notification token.'
          : PUSH_FAILURE_KIND_PLAIN_COPY[kind],
      detail: outcome.error,
    };
  }
  return { value: describeRegisterOutcome(outcome) };
};

// ─────────────────────────────────────────────────────────────
// Which app is this token for?
// ─────────────────────────────────────────────────────────────

/**
 * The identity a push token is minted under.
 *
 * On device, a job's push audit came back "Could not find APNs credentials for
 * com.lanternstudy.app.dev" — on an ANDROID emulator. Two things were invisible
 * and both are named here: which platform asked for the token, and which
 * application id / EAS project it was asked for. Expo routes a push by the
 * identity recorded WITH the token, not by the device that is asking now, so a
 * token left on the account by another build (a `.dev` variant, or an iOS one)
 * keeps being delivered to that build's credentials forever.
 */
export interface PushAppIdentity {
  /** 'android' | 'ios' | 'web' — whatever the runtime reports. */
  platform: string;
  /** android.package / ios.bundleIdentifier of THIS build. */
  applicationId?: string | null;
  /** extra.eas.projectId — the project whose credentials Expo will look up. */
  projectId?: string | null;
  /** development | preview | production, from extra.appVariant. */
  appVariant?: string | null;
  /** 'fcm' | 'apns' when the native token type is known. */
  deviceTokenType?: string | null;
}

/** Two identities, compared the way Expo compares them: exactly. */
export const identityMatches = (
  a: PushAppIdentity | null | undefined,
  b: PushAppIdentity | null | undefined
): boolean => {
  if (!a || !b) return false;
  return a.platform === b.platform && (a.applicationId ?? null) === (b.applicationId ?? null);
};

/**
 * The identity rows, for the delivery panel.
 *
 * Stated even when everything is fine: this is the pair of facts a founder
 * needs in a screenshot to tell "no credentials uploaded" from "credentials
 * uploaded for the wrong app id", and neither can be recovered afterwards.
 */
export const pushIdentityRows = (
  identity: PushAppIdentity | null | undefined
): PushDiagnosticRow[] => {
  if (!identity) return [];
  const rows: PushDiagnosticRow[] = [];
  rows.push({
    key: 'app-identity',
    label: 'This build',
    value: `${identity.platform}${identity.applicationId ? ` · ${identity.applicationId}` : ''}${
      identity.appVariant ? ` (${identity.appVariant})` : ''
    }`,
    state: 'ok',
  });
  if (identity.deviceTokenType) {
    rows.push({
      key: 'device-token-type',
      label: 'Delivery service',
      // FCM on Android, APNs on iOS. Anything else is the mismatch itself.
      value:
        identity.deviceTokenType === 'fcm'
          ? 'FCM (Android)'
          : identity.deviceTokenType === 'apns'
            ? 'APNs (iOS)'
            : identity.deviceTokenType,
      state:
        (identity.platform === 'android' && identity.deviceTokenType === 'fcm') ||
        (identity.platform === 'ios' && identity.deviceTokenType === 'apns')
          ? 'ok'
          : 'bad',
    });
  }
  return rows;
};

/**
 * Why the OS or Expo refused to mint a token, verbatim.
 *
 * `registerForPushNotifications` used to swallow this into `null`, which is
 * how "Android has no FCM configuration in this build" looked identical to
 * "the student said no". A row that says nothing is worse than no row, so this
 * returns none when there was no error.
 */
export const pushErrorRows = (error: string | null | undefined): PushDiagnosticRow[] => {
  if (!error) return [];
  // Same split, and the SAME classifier, as a job push failure. On device this
  // row printed the raw "Make sure to complete the guide at
  // https://docs.expo.dev/… Default FirebaseApp is not initialized in this
  // process com.lanternstudy.app" — an Expo docs URL and a build id — straight
  // at a student. A recognised shape now gets its plain, classified sentence
  // ("Notifications are not set up for this build yet."); an unrecognised one
  // keeps the honest generic line. The verbatim text stays behind the
  // disclosure either way, where a bug report can reach it.
  const kind = classifyPushFailure(error);
  return [
    {
      key: 'register-error',
      label: 'Last registration error',
      value:
        kind === 'unknown'
          ? 'This phone could not get a notification token.'
          : PUSH_FAILURE_KIND_PLAIN_COPY[kind],
      detail: error,
      state: 'bad',
    },
  ];
};

/** True when any row is carrying build-facing text behind the disclosure. */
export const hasPushDetails = (rows: readonly PushDiagnosticRow[]): boolean =>
  rows.some((row) => Boolean(row.detail));

// ─────────────────────────────────────────────────────────────
// The Settings switch, and what it is allowed to claim
// ─────────────────────────────────────────────────────────────

/**
 * What the "Push Notifications" row shows.
 *
 * On device the switch read ON while the panel four lines above it said
 * "Permission on this phone: Not allowed yet" and "Push token on this device:
 * None yet" — the switch was reporting a stored PREFERENCE and reading as a
 * promise about this phone. A student with it on got nothing and had no reason
 * to look further.
 *
 * So the switch now shows what will actually happen here: on only when the
 * preference is on AND this device can be reached. `unknown` — the server
 * could not be asked — follows the preference, because a failed request is not
 * evidence that notifications are off. The subtitle always names the half that
 * is missing, and `needsPermission` tells the screen that flipping it on has
 * to ask the OS rather than only writing a setting.
 */
export interface PushToggleState {
  /** What the switch renders. */
  value: boolean;
  /** The row's subtitle: the real state, in one sentence. */
  subtitle: string;
  /** Turning it on must request the OS permission (and mint a token) first. */
  needsPermission: boolean;
  /** The OS has refused for good; only system settings can undo it. */
  blockedInSystemSettings: boolean;
}

export const pushToggleState = (
  enabled: boolean,
  input: PushReadinessInput
): PushToggleState => {
  const readiness = pushReadiness(input);
  const blockedInSystemSettings =
    input.permission === 'denied' || input.permission === 'unavailable';
  const needsPermission = enabled && input.supported && input.permission !== 'granted';

  if (!enabled) {
    return {
      value: false,
      subtitle: 'Off — nothing is sent to this phone.',
      needsPermission: false,
      blockedInSystemSettings,
    };
  }

  if (!input.supported) {
    return {
      value: false,
      subtitle: 'On for your account — this build cannot receive push.',
      needsPermission: false,
      blockedInSystemSettings,
    };
  }

  if (input.permission !== 'granted') {
    return {
      value: false,
      subtitle: blockedInSystemSettings
        ? 'On for your account — this phone blocks notifications in system settings.'
        : 'On for your account — this phone has not allowed notifications yet.',
      needsPermission,
      blockedInSystemSettings,
    };
  }

  if (readiness === 'unknown') {
    return {
      value: true,
      subtitle: "On — we couldn't check with the server just now.",
      needsPermission: false,
      blockedInSystemSettings,
    };
  }

  if (readiness === 'off') {
    return {
      value: false,
      subtitle: input.server && !input.server.pushEnabled
        ? 'On here, off for your account on the server.'
        : 'On for your account — this phone is not registered yet.',
      needsPermission: false,
      blockedInSystemSettings,
    };
  }

  return {
    value: true,
    subtitle: 'On — this phone gets alerts about finished work.',
    needsPermission: false,
    blockedInSystemSettings,
  };
};

// ─────────────────────────────────────────────────────────────
// The per-category switches, and whether they can do anything
// ─────────────────────────────────────────────────────────────

/**
 * Whether the ten per-category notification switches can deliver anything.
 *
 * Settings listed a "Push & in-app" group — Daily Reminders, Group Activity,
 * Test Results and seven more — every switch reading ON, directly beneath a
 * panel that said "Permission on this phone: Not allowed yet". None of them
 * could deliver a thing, local OR push, because the OS had allowed no
 * notification at all. A switch that writes a preference nothing will ever
 * read is a promise the app cannot keep.
 *
 * The group is gated on the one precondition every category shares: this build
 * supports notifications AND the OS has granted permission. It is deliberately
 * NOT gated on the server token — a local reminder still fires without one —
 * so a device that is merely unregistered keeps its reminders. When this
 * returns `disabled`, Settings dims the group and shows `note`; the master
 * Push switch above it stays live so the student can grant permission there.
 */
export interface NotificationCategoriesState {
  /** The category switches cannot deliver anything — render them inert. */
  disabled: boolean;
  /** One line saying why, or '' when the switches are live. */
  note: string;
}

export const notificationCategoriesState = (
  input: PushReadinessInput
): NotificationCategoriesState => {
  if (!input.supported) {
    return {
      disabled: true,
      note: "This build can't show notifications, so these choices won't take effect here.",
    };
  }
  if (input.permission === 'denied' || input.permission === 'unavailable') {
    return {
      disabled: true,
      note: "Notifications are blocked in your phone's system settings, so none of these can be delivered yet.",
    };
  }
  if (input.permission !== 'granted') {
    return {
      disabled: true,
      note: "This phone hasn't allowed notifications yet, so none of these can be delivered.",
    };
  }
  return { disabled: false, note: '' };
};
