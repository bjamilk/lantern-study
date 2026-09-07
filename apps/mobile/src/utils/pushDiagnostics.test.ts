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
  maskToken,
  identityMatches,
  pushDiagnosticRows,
  pushErrorRows,
  pushIdentityRows,
  pushReadiness,
  pushReadinessSummary,
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

  it('shows the failure verbatim, never a paraphrase', () => {
    const [row] = pushErrorRows('Default FirebaseApp is not initialized');
    expect(row.value).toBe('Default FirebaseApp is not initialized');
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
    expect(rows[0].value).toContain('Apple push credentials');
    expect(rows[0].value).toContain('Could not find APNs credentials');
    expect(jobPushFailureRows(audit({ tokenCount: 1 }))).toEqual([]);
  });
});
