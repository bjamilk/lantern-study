/**
 * The rules that decide what the app says about a push it may or may not have
 * sent. Every assertion here is about a claim the student reads as fact.
 */
import type { JobPushAudit } from '../stores/jobsCore';
import {
  PUSH_FAILED_STUDENT_COPY,
  PUSH_SENT_COPY,
  classifyPushFailure,
  describeJobPush,
  jobPushFailureDetail,
  jobPushFailureRows,
  describeRegisterOutcome,
  registerOutcomeParts,
  maskToken,
  identityMatches,
  pushDiagnosticRows,
  pushErrorRows,
  pushIdentityRows,
  pushToggleState,
  hasPushDetails,
  pushReadiness,
  pushReadinessSummary,
  notificationCategoriesState,
  type PushReadinessInput,
} from './pushDiagnostics';

const audit = (over: Partial<JobPushAudit> = {}): JobPushAudit => ({
  attemptedAt: '2026-09-05T10:00:00.000Z',
  ...over,
});

describe('describeJobPush', () => {
  it('says nothing when the record carries no audit', () => {
    expect(describeJobPush(undefined)).toBeNull();
    expect(describeJobPush(null)).toBeNull();
    // A malformed record is not evidence either way.
    expect(describeJobPush({ } as JobPushAudit)).toBeNull();
  });

  it('confirms a push that actually went out', () => {
    expect(describeJobPush(audit({ tokenCount: 1 }))).toBe(PUSH_SENT_COPY);
  });

  it('maps every skip reason to plain words, never a code', () => {
    const cases: Array<[JobPushAudit['skippedReason'], string]> = [
      ['no_token', 'Push skipped: no push token on this device'],
      ['prefs_off', 'Push skipped: notifications are off in Settings'],
      ['disabled', 'Push skipped: push is off on the server'],
      ['not_pushable', "Push skipped: this kind doesn't notify"],
      ['claimed', 'Push skipped: already sent'],
    ];
    for (const [reason, copy] of cases) {
      const line = describeJobPush(audit({ skippedReason: reason }));
      expect(line).toBe(copy);
      expect(line).not.toContain(String(reason));
    }
  });

  it('says one plain sentence when the push failed, never the raw reason', () => {
    // The build 168 defect: this exact string reached a student's job sheet.
    const apns =
      'Could not find APNs credentials for com.lanternstudy.app.dev ' +
      '(@bjamilk/lantern-study). You may need to generate or upload new push credentials.';
    const line = describeJobPush(audit({ skippedReason: 'error', error: apns }));
    expect(line).toBe(PUSH_FAILED_STUDENT_COPY);
    expect(line).not.toContain('APNs');
    expect(line).not.toContain('com.lanternstudy');
    expect(describeJobPush(audit({ skippedReason: 'error' }))).toBe(PUSH_FAILED_STUDENT_COPY);
  });

  it('counts an Expo rejection as a failure, not a delivery', () => {
    const line = describeJobPush(
      audit({
        tokenCount: 1,
        expoTickets: [{ status: 'error', message: 'DeviceNotRegistered' }],
      })
    );
    expect(line).toBe(PUSH_FAILED_STUDENT_COPY);
    expect(line).not.toContain('DeviceNotRegistered');
  });

  it('does not claim delivery when nothing was sent to', () => {
    expect(describeJobPush(audit({ tokenCount: 0 }))).toBe(
      'Push skipped: no push token on this device'
    );
  });

  it('shows an unknown reason rather than swallowing it', () => {
    const line = describeJobPush(audit({ skippedReason: 'quota' as never }));
    expect(line).toBe('Push skipped: quota');
  });
});

describe('pushReadiness', () => {
  const base: PushReadinessInput = {
    supported: true,
    permission: 'granted',
    deviceToken: 'ExponentPushToken[abcdef123456]',
    server: { hasToken: true, pushEnabled: true },
  };

  it('is ready only when the OS, the token and the account all agree', () => {
    expect(pushReadiness(base)).toBe('ready');
  });

  it('is off when the OS has not granted permission', () => {
    expect(pushReadiness({ ...base, permission: 'denied' })).toBe('off');
    expect(pushReadiness({ ...base, permission: 'undetermined' })).toBe('off');
  });

  it('is off when the build cannot receive a push at all', () => {
    expect(pushReadiness({ ...base, supported: false })).toBe('off');
  });

  it('is off when the server holds no token or the account switch is off', () => {
    expect(pushReadiness({ ...base, server: { hasToken: false, pushEnabled: true } })).toBe('off');
    expect(pushReadiness({ ...base, server: { hasToken: true, pushEnabled: false } })).toBe('off');
  });

  it('is unknown — not off — when the server could not be asked', () => {
    expect(pushReadiness({ ...base, server: null })).toBe('unknown');
  });
});

describe('pushDiagnosticRows', () => {
  it('states each fact separately so the student knows which half is broken', () => {
    const rows = pushDiagnosticRows({
      supported: true,
      permission: 'granted',
      deviceToken: 'ExponentPushToken[abcdef123456]',
      server: { hasToken: false, pushEnabled: true },
    });
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.permission.state).toBe('ok');
    expect(byKey['device-token'].state).toBe('ok');
    expect(byKey['server-token'].state).toBe('bad');
    expect(byKey['server-prefs'].state).toBe('ok');
  });

  it("says it could not check rather than reporting 'no'", () => {
    const rows = pushDiagnosticRows({
      supported: true,
      permission: 'granted',
      deviceToken: null,
      server: null,
    });
    const server = rows.find((r) => r.key === 'server-token');
    expect(server?.state).toBe('unknown');
    expect(server?.value).toMatch(/couldn't check/i);
    // A device that never registered is unknown, not a failure: registration
    // runs at sign-in and this process may simply not have done it yet.
    expect(rows.find((r) => r.key === 'device-token')?.state).toBe('unknown');
  });

  it('reduces to one honest row in a build with no push at all', () => {
    const rows = pushDiagnosticRows({
      supported: false,
      permission: 'unavailable',
      deviceToken: null,
      server: null,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe('support');
  });

  it('never shows a whole push token', () => {
    const rows = pushDiagnosticRows({
      supported: true,
      permission: 'granted',
      deviceToken: 'ExponentPushToken[abcdef123456]',
      server: { hasToken: true, pushEnabled: true },
    });
    const value = rows.find((r) => r.key === 'device-token')?.value ?? '';
    expect(value).not.toContain('abcdef');
    expect(value).toBe(maskToken('ExponentPushToken[abcdef123456]'));
  });
});

describe('pushReadinessSummary', () => {
  it('tells a student with no push what will actually happen instead', () => {
    const summary = pushReadinessSummary({
      supported: true,
      permission: 'denied',
      deviceToken: null,
      server: null,
    });
    expect(summary).toContain('reopen the app');
  });

  it('does not claim notifications are off when it could not check', () => {
    const summary = pushReadinessSummary({
      supported: true,
      permission: 'granted',
      deviceToken: 'ExponentPushToken[abcdef123456]',
      server: null,
    });
    expect(summary).toMatch(/couldn't check/i);
    expect(summary).not.toMatch(/notifications are off/i);
  });
});

describe('describeRegisterOutcome', () => {
  it('keeps the failure verbatim', () => {
    expect(
      describeRegisterOutcome({
        token: null,
        uploaded: false,
        error: 'Push notifications are disabled in your settings',
      })
    ).toBe('Failed: Push notifications are disabled in your settings');
  });

  it('separates "no token" from "the server would not take it"', () => {
    expect(describeRegisterOutcome({ token: null, uploaded: false })).toMatch(/No token/);
    expect(
      describeRegisterOutcome({ token: 'ExponentPushToken[abcdef123456]', uploaded: false })
    ).toMatch(/couldn't hand it to the server/);
  });

  it('confirms success with the token it registered', () => {
    expect(
      describeRegisterOutcome({ token: 'ExponentPushToken[abcdef123456]', uploaded: true })
    ).toBe('Registered …123456 with the server.');
  });
});

describe('registerOutcomeParts', () => {
  // The exact string the device printed at a student after one press of
  // "Re-register this device": a docs URL, a build id, and an internal
  // Firebase message. None of it may appear in the half that is always shown.
  const RAW =
    'Encountered an error: Make sure to complete the guide at ' +
    'https://docs.expo.dev/push-notifications/fcm-credentials/ — ' +
    'Default FirebaseApp is not initialized in this process com.lanternstudy.app.';

  it('shows a plain sentence and keeps the raw text for the disclosure', () => {
    const parts = registerOutcomeParts({ token: null, uploaded: false, error: RAW });
    expect(parts.value).toBe('Notifications are not set up for this build yet.');
    expect(parts.value).not.toMatch(/http|firebase|com\.lanternstudy/i);
    expect(parts.detail).toBe(RAW);
  });

  it('falls back to an honest generic line when the shape is unrecognised', () => {
    const parts = registerOutcomeParts({
      token: null,
      uploaded: false,
      error: 'something nobody has seen before',
    });
    expect(parts.value).toBe('This phone could not get a notification token.');
    expect(parts.value).not.toContain('something nobody has seen before');
    expect(parts.detail).toBe('something nobody has seen before');
  });

  it('leaves the non-failure outcomes exactly as they were, with no detail', () => {
    expect(registerOutcomeParts({ token: null, uploaded: false })).toEqual({
      value: describeRegisterOutcome({ token: null, uploaded: false }),
    });
    expect(
      registerOutcomeParts({ token: 'ExponentPushToken[abcdef123456]', uploaded: true })
    ).toEqual({ value: 'Registered …123456 with the server.' });
  });
});

describe('push app identity', () => {
  it('says nothing when the identity is unknown', () => {
    expect(pushIdentityRows(null)).toEqual([]);
    expect(pushIdentityRows(undefined)).toEqual([]);
  });

  it('names the platform and application id of this build', () => {
    const [row] = pushIdentityRows({
      platform: 'android',
      applicationId: 'com.lanternstudy.app',
      appVariant: 'preview',
    });
    expect(row.value).toContain('android');
    expect(row.value).toContain('com.lanternstudy.app');
    expect(row.value).toContain('preview');
  });

  it('flags an Android build whose token is routed to APNs', () => {
    // The device failure verbatim: an Android emulator whose push came back
    // "Could not find APNs credentials". The transport row is the only place
    // that contradiction is visible on the phone.
    const rows = pushIdentityRows({
      platform: 'android',
      applicationId: 'com.lanternstudy.app.dev',
      deviceTokenType: 'apns',
    });
    const transport = rows.find((r) => r.key === 'device-token-type');
    expect(transport?.state).toBe('bad');
  });

  it('accepts the transport each platform is supposed to use', () => {
    expect(
      pushIdentityRows({ platform: 'android', deviceTokenType: 'fcm' }).find(
        (r) => r.key === 'device-token-type'
      )?.state
    ).toBe('ok');
    expect(
      pushIdentityRows({ platform: 'ios', deviceTokenType: 'apns' }).find(
        (r) => r.key === 'device-token-type'
      )?.state
    ).toBe('ok');
  });

  it('treats a different application id as a different app', () => {
    const android = { platform: 'android', applicationId: 'com.lanternstudy.app' };
    expect(identityMatches(android, { ...android })).toBe(true);
    expect(identityMatches(android, { ...android, applicationId: 'com.lanternstudy.app.dev' })).toBe(
      false
    );
    expect(identityMatches(android, { ...android, platform: 'ios' })).toBe(false);
    expect(identityMatches(android, null)).toBe(false);
  });
});

describe('pushErrorRows', () => {
  it('adds no row when nothing failed', () => {
    expect(pushErrorRows(null)).toEqual([]);
    expect(pushErrorRows('')).toEqual([]);
  });

  it('classifies the FirebaseApp failure the same way a job push failure is', () => {
    // The device defect: "Last registration error: Make sure to complete the
    // guide at https://docs.expo.dev/push-notifications/fcm-credentials/ :
    // Default FirebaseApp is not initialized in this process
    // com.lanternstudy.app. Make sure to call FirebaseApp.initializeApp(...)"
    // was printed straight at a student — an Expo docs URL and a bundle id.
    const raw =
      'Make sure to complete the guide at ' +
      'https://docs.expo.dev/push-notifications/fcm-credentials/ : ' +
      'Default FirebaseApp is not initialized in this process com.lanternstudy.app.';
    const [row] = pushErrorRows(raw);
    // The student's half: a plain, classified sentence, no build words.
    expect(row.value).toBe('Notifications are not set up for this build yet.');
    expect(row.value).not.toMatch(/firebase/i);
    expect(row.value).not.toContain('com.lanternstudy');
    expect(row.value).not.toContain('docs.expo.dev');
    // Verbatim, still — behind "Show details", where a bug report can reach it.
    expect(row.detail).toBe(raw);
    expect(row.state).toBe('bad');
  });

  it('never leaks the Expo account handle into the plain sentence', () => {
    const raw =
      'Could not find APNs credentials for com.lanternstudy.app.dev ' +
      '(@bjamilk/lantern-study). You may need to generate or upload new push credentials.';
    const [row] = pushErrorRows(raw);
    expect(row.value).toBe('Notifications are not set up for this build yet.');
    expect(row.value).not.toContain('@bjamilk');
    expect(row.value).not.toContain('APNs');
    expect(row.detail).toBe(raw);
  });

  it('keeps the honest generic line when the error is unrecognised', () => {
    const [row] = pushErrorRows('502 Bad Gateway');
    expect(row.value).toBe('This phone could not get a notification token.');
    expect(row.detail).toBe('502 Bad Gateway');
    expect(row.state).toBe('bad');
  });
});

describe('classifyPushFailure', () => {
  it('names every Expo failure shape we have seen', () => {
    expect(
      classifyPushFailure(
        'Could not find APNs credentials for com.lanternstudy.app.dev (@bjamilk/lantern-study). ' +
          'You may need to generate or upload new push credentials.'
      )
    ).toBe('apns-credentials');
    expect(classifyPushFailure('DeviceNotRegistered')).toBe('device-not-registered');
    expect(classifyPushFailure('InvalidCredentials')).toBe('invalid-credentials');
    expect(classifyPushFailure('MessageRateExceeded')).toBe('rate-limited');
  });

  it('reads the Android FCM / Firebase shapes as their own kind', () => {
    // The exact Android emulator strings, both of which name Firebase or FCM,
    // never Apple. Kept distinct from the APNs kind so the disclosure line does
    // not tell an Android student their Apple credentials are missing.
    expect(classifyPushFailure('Default FirebaseApp is not initialized in this process')).toBe(
      'fcm-credentials'
    );
    expect(
      classifyPushFailure(
        'Make sure to complete the guide at https://docs.expo.dev/push-notifications/fcm-credentials/'
      )
    ).toBe('fcm-credentials');
    // The FCM URL must not be mistaken for the Apple branch, even though "push
    // credentials" appears elsewhere in Expo's prose.
    expect(classifyPushFailure('no FCM credentials configured for this build')).toBe(
      'fcm-credentials'
    );
  });

  it('is case-insensitive, because these arrive from three different layers', () => {
    expect(classifyPushFailure('devicenotregistered')).toBe('device-not-registered');
    expect(classifyPushFailure('MESSAGERATEEXCEEDED')).toBe('rate-limited');
  });

  it('guesses nothing when it does not recognise the message', () => {
    expect(classifyPushFailure('502 Bad Gateway')).toBe('unknown');
    expect(classifyPushFailure('')).toBe('unknown');
    expect(classifyPushFailure(null)).toBe('unknown');
    expect(classifyPushFailure(undefined)).toBe('unknown');
  });
});

describe('jobPushFailureDetail', () => {
  it('keeps the raw text for the diagnostics panel', () => {
    expect(jobPushFailureDetail(audit({ skippedReason: 'error', error: 'APNs missing' }))).toBe(
      'APNs missing'
    );
    expect(
      jobPushFailureDetail(
        audit({ tokenCount: 1, expoTickets: [{ status: 'error', message: 'DeviceNotRegistered' }] })
      )
    ).toBe('DeviceNotRegistered');
  });

  it('is null when nothing failed', () => {
    expect(jobPushFailureDetail(audit({ tokenCount: 1 }))).toBeNull();
    expect(jobPushFailureDetail(null)).toBeNull();
  });

  it('yields one diagnostics row that names the cause AND keeps the words', () => {
    const rows = jobPushFailureRows(
      audit({ skippedReason: 'error', error: 'Could not find APNs credentials' })
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe('bad');
    // The student's half names no build, no bundle id and no EAS slug.
    expect(rows[0].value).toBe('Notifications are not set up for this build yet.');
    expect(rows[0].value).not.toContain('APNs');
    // The founder's half keeps every word of it.
    expect(rows[0].detail).toContain('Apple push credentials');
    expect(rows[0].detail).toContain('Could not find APNs credentials');
    expect(jobPushFailureRows(audit({ tokenCount: 1 }))).toEqual([]);
  });
});

describe('hasPushDetails', () => {
  it('is true only when a row is holding build words back', () => {
    expect(hasPushDetails(pushDiagnosticRows({ supported: true, permission: 'granted', server: null }))).toBe(
      false
    );
    expect(hasPushDetails(pushErrorRows('Default FirebaseApp is not initialized'))).toBe(true);
  });
});

describe('pushToggleState', () => {
  const ready: PushReadinessInput = {
    supported: true,
    permission: 'granted',
    deviceToken: 'ExponentPushToken[abcdef]',
    server: { hasToken: true, pushEnabled: true },
  };

  it('shows on only when this phone will actually be reached', () => {
    const state = pushToggleState(true, ready);
    expect(state.value).toBe(true);
    expect(state.subtitle).toBe('On — this phone gets alerts about finished work.');
    expect(state.needsPermission).toBe(false);
  });

  it('does not read as on while the OS has not allowed it', () => {
    // The defect: the switch said ON three lines under "Permission on this
    // phone: Not allowed yet".
    const state = pushToggleState(true, { ...ready, permission: 'undetermined', deviceToken: null });
    expect(state.value).toBe(false);
    expect(state.subtitle).toContain('has not allowed notifications yet');
    expect(state.needsPermission).toBe(true);
  });

  it('sends a hard refusal to system settings rather than asking again', () => {
    const state = pushToggleState(true, { ...ready, permission: 'denied', deviceToken: null });
    expect(state.value).toBe(false);
    expect(state.blockedInSystemSettings).toBe(true);
    expect(state.subtitle).toContain('system settings');
  });

  it('follows the preference when the server could not be asked', () => {
    // A failed request is not evidence that notifications are off.
    const state = pushToggleState(true, { ...ready, server: null });
    expect(state.value).toBe(true);
    expect(state.subtitle).toContain("couldn't check");
  });

  it('says which side is off when the server holds no token', () => {
    const state = pushToggleState(true, { ...ready, server: { hasToken: false, pushEnabled: true } });
    expect(state.value).toBe(false);
    expect(state.subtitle).toContain('not registered yet');
  });

  it('is plainly off when the student turned it off', () => {
    const state = pushToggleState(false, ready);
    expect(state.value).toBe(false);
    expect(state.subtitle).toBe('Off — nothing is sent to this phone.');
    expect(state.needsPermission).toBe(false);
  });

  it('never claims this build can be reached when it cannot', () => {
    const state = pushToggleState(true, { ...ready, supported: false });
    expect(state.value).toBe(false);
    expect(state.subtitle).toContain('cannot receive push');
  });
});

describe('notificationCategoriesState', () => {
  const live: PushReadinessInput = {
    supported: true,
    permission: 'granted',
    deviceToken: 'ExponentPushToken[abcdef]',
    server: { hasToken: true, pushEnabled: true },
  };

  it('lets the switches be live when the OS has allowed notifications', () => {
    const state = notificationCategoriesState(live);
    expect(state.disabled).toBe(false);
    expect(state.note).toBe('');
  });

  it('disables the group when the OS has not allowed notifications yet', () => {
    // The device defect: ten switches read ON directly under "Permission on
    // this phone: Not allowed yet".
    const state = notificationCategoriesState({ ...live, permission: 'undetermined', deviceToken: null });
    expect(state.disabled).toBe(true);
    expect(state.note).toMatch(/hasn't allowed notifications yet/i);
    // Plain copy: no internal key, handle, filename or raw server text.
    expect(state.note).not.toMatch(/permission|granted|token/i);
  });

  it('points a hard refusal at system settings', () => {
    const state = notificationCategoriesState({ ...live, permission: 'denied', deviceToken: null });
    expect(state.disabled).toBe(true);
    expect(state.note).toMatch(/system settings/i);
  });

  it('disables the group when the build cannot show notifications at all', () => {
    const state = notificationCategoriesState({
      supported: false,
      permission: 'unavailable',
      deviceToken: null,
      server: null,
    });
    expect(state.disabled).toBe(true);
    expect(state.note).toMatch(/can't show notifications/i);
  });

  it('keeps the switches live for a merely-unregistered device, so local reminders still fire', () => {
    // Gated on OS permission, NOT the server token: a local reminder needs no
    // token, so a granted-but-unregistered phone keeps its category switches.
    expect(
      notificationCategoriesState({ ...live, server: { hasToken: false, pushEnabled: true } }).disabled
    ).toBe(false);
    // And when the server simply could not be reached.
    expect(notificationCategoriesState({ ...live, server: null }).disabled).toBe(false);
  });
});

describe('jobPushFailureRows — Android FCM', () => {
  it('tells the student it is not set up, and keeps FCM words for the founder', () => {
    const rows = jobPushFailureRows(
      audit({
        skippedReason: 'error',
        error:
          'Make sure to complete the guide at ' +
          'https://docs.expo.dev/push-notifications/fcm-credentials/ : ' +
          'Default FirebaseApp is not initialized in this process com.lanternstudy.app.',
      })
    );
    expect(rows).toHaveLength(1);
    // Same plain sentence as the APNs case: it is not set up for this build.
    expect(rows[0].value).toBe('Notifications are not set up for this build yet.');
    // But the disclosure names the ANDROID cause, not an Apple one.
    expect(rows[0].detail).toContain('FCM');
    expect(rows[0].detail).not.toContain('Apple');
    expect(rows[0].detail).toContain('Default FirebaseApp is not initialized');
  });
});
