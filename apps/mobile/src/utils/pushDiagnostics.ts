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

  if (audit.skippedReason === 'error') {
    const message = audit.error?.trim() || ticketError(audit);
    return message ? `Push failed: ${message}` : 'Push failed';
  }
  if (audit.skippedReason) {
    return `Push skipped: ${PUSH_SKIP_REASON_COPY[audit.skippedReason] ?? audit.skippedReason}`;
  }

  // No skip reason: the server tried. Expo can still have rejected it, and a
  // rejected ticket is not a delivery.
  const rejected = ticketError(audit);
  if (rejected) return `Push failed: ${rejected}`;
  if (audit.tokenCount === 0) {
    return `Push skipped: ${PUSH_SKIP_REASON_COPY.no_token}`;
  }
  return PUSH_SENT_COPY;
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
    | 'register-error';
  label: string;
  value: string;
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
  return [
    {
      key: 'register-error',
      label: 'Last registration error',
      value: error,
      state: 'bad',
    },
  ];
};
