/**
 * The deep-link policy: what the app accepts from a URL, and what it must ask
 * before acting. These are security rules, so each test names the attack it
 * stops rather than the branch it covers.
 */
import {
  describeAuthLink,
  emailFromAccessToken,
  inviteIdFromUrl,
  isAllowedMobileAuthUrl,
  isAllowedMobileDeepLink,
  planAuthDeepLink,
  planInviteDeepLink,
  setRuntimeDeepLinkSchemes,
} from './deepLinkAllowlist';

// Default every test to a RELEASE build's configuration (the production scheme
// and nothing else), so the scheme gate is deterministic under node.
beforeEach(() => setRuntimeDeepLinkSchemes([]));
afterEach(() => setRuntimeDeepLinkSchemes(null));

/** An unsigned JWT whose payload carries an email — the prompt reads this. */
function accessTokenFor(email: string): string {
  const payload = Buffer.from(JSON.stringify({ email, sub: 'u-1' }))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${payload}.signature`;
}

const ATTACKER_LINK = `lanternstudy://reset-password#access_token=${accessTokenFor(
  'attacker@evil.test'
)}&refresh_token=r-attacker`;

describe('isAllowedMobileDeepLink', () => {
  it('accepts the app scheme and the app host', () => {
    expect(isAllowedMobileDeepLink('lanternstudy://jobs/123')).toBe(true);
    expect(isAllowedMobileDeepLink('lanternstudy:/jobs/123')).toBe(true);
    expect(isAllowedMobileDeepLink('https://lanternstudy.com/invite/abc')).toBe(true);
    expect(isAllowedMobileDeepLink('https://www.lanternstudy.com/invite/abc')).toBe(true);
  });

  it('rejects another site, even one whose name contains ours', () => {
    expect(isAllowedMobileDeepLink('https://lanternstudy.com.evil.test/invite/abc')).toBe(false);
    expect(isAllowedMobileDeepLink('https://evil.test/invite/abc')).toBe(false);
  });

  it('rejects an unknown scheme instead of gluing it onto our own host', () => {
    // The old rule concatenated anything it did not recognise onto
    // "https://lanternstudy.com/", then checked the host of the string it had
    // just built — so every scheme passed.
    expect(isAllowedMobileDeepLink('evil://reset-password?access_token=x')).toBe(false);
    expect(isAllowedMobileDeepLink('javascript:alert(1)')).toBe(false);
    expect(isAllowedMobileDeepLink('lanternstudyx://reset-password')).toBe(false);
  });

  it("accepts a build's own configured scheme and nobody else's", () => {
    const expoGo = 'exp://10.0.2.2:8081/--/reset-password';
    const devClient = 'com.lanternstudy.app.dev://reset-password';

    // A release build: the production scheme only.
    expect(isAllowedMobileDeepLink('lanternstudy://reset-password')).toBe(true);
    expect(isAllowedMobileDeepLink(expoGo)).toBe(false);
    expect(isAllowedMobileDeepLink(devClient)).toBe(false);

    // A dev client, whose own scheme is com.lanternstudy.app.dev.
    setRuntimeDeepLinkSchemes(['com.lanternstudy.app.dev://']);
    expect(isAllowedMobileDeepLink(devClient)).toBe(true);
    expect(isAllowedMobileDeepLink('lanternstudy://reset-password')).toBe(true);
    // Not the neighbouring variant, and not a stranger.
    expect(isAllowedMobileDeepLink('com.lanternstudy.app://reset-password')).toBe(false);
    expect(isAllowedMobileDeepLink('com.attacker.app://reset-password')).toBe(false);
    expect(isAllowedMobileDeepLink(expoGo)).toBe(false);

    // Expo Go, whose prefix is exp://host:port/--/.
    setRuntimeDeepLinkSchemes(['exp://10.0.2.2:8081/--/']);
    expect(isAllowedMobileDeepLink(expoGo)).toBe(true);
    expect(isAllowedMobileDeepLink(devClient)).toBe(false);
  });

  it('gates on the configured scheme, not on __DEV__ (a release dev client still opens auth links)', () => {
    const devClient = 'com.lanternstudy.app.dev://reset-password';
    const dev = globalThis as { __DEV__?: boolean };
    const restore = dev.__DEV__;
    try {
      // The M5 case: __DEV__ is false, but this IS the dev client's own scheme.
      dev.__DEV__ = false;
      setRuntimeDeepLinkSchemes(['com.lanternstudy.app.dev://']);
      expect(isAllowedMobileDeepLink(devClient)).toBe(true);
      expect(isAllowedMobileAuthUrl(`${devClient}?code=pkce-1`)).toBe(true);

      // And the converse: a debug build is not a free pass for a scheme that is
      // not this build's.
      dev.__DEV__ = true;
      setRuntimeDeepLinkSchemes([]);
      expect(isAllowedMobileDeepLink(devClient)).toBe(false);
      expect(isAllowedMobileDeepLink('exp://10.0.2.2:8081/--/reset-password')).toBe(false);
    } finally {
      if (restore === undefined) delete dev.__DEV__;
      else dev.__DEV__ = restore;
    }
  });

  it('accepts the OAuth PKCE callback the app actually receives', () => {
    // `makeRedirectUri({ scheme: 'lanternstudy' })` is the bare scheme, so
    // Supabase returns `lanternstudy://?code=…` with NO path. It has to pass the
    // allowlist (Android resumes the app through it) …
    const callback = 'lanternstudy://?code=pkce-abc123';
    expect(isAllowedMobileDeepLink(callback)).toBe(true);
    expect(isAllowedMobileDeepLink('lanternstudy://#code=pkce-abc123')).toBe(true);

    // … and must NOT be mistaken for a session-establishing auth link: the
    // OAuth flow is completed by expo-web-browser, and the deep-link handler
    // prompting "Sign in?" over the top of it would be a second, duplicate
    // exchange of the same one-time code.
    expect(describeAuthLink(callback)).toMatchObject({ allowed: true, kind: null });
    expect(isAllowedMobileAuthUrl(callback)).toBe(false);
    expect(planAuthDeepLink(callback, { userId: 'u-1' })).toEqual({
      action: 'ignore',
      reason: 'not-an-auth-link',
    });
  });

  it('accepts the expo-auth-session return URL of the build it belongs to', () => {
    const expoGoCallback = 'exp://10.0.2.2:8081/--/?code=pkce-abc123';
    expect(isAllowedMobileDeepLink(expoGoCallback)).toBe(false);

    setRuntimeDeepLinkSchemes(['exp://10.0.2.2:8081/--/']);
    expect(isAllowedMobileDeepLink(expoGoCallback)).toBe(true);
    expect(describeAuthLink(expoGoCallback)).toMatchObject({ allowed: true, kind: null });
  });

  it('surfaces a provider error on the callback instead of dropping it', () => {
    const denied = 'lanternstudy://verify-email?error=access_denied&error_code=access_denied';
    expect(describeAuthLink(denied).errorCode).toBe('access_denied');
    expect(planAuthDeepLink(denied)).toEqual({ action: 'show-error', errorCode: 'access_denied' });
  });

  it('rejects junk', () => {
    expect(isAllowedMobileDeepLink('')).toBe(false);
    expect(isAllowedMobileDeepLink('not a url')).toBe(false);
    expect(isAllowedMobileDeepLink(null as unknown as string)).toBe(false);
  });
});

describe('describeAuthLink', () => {
  it('reads the account out of an implicit-grant link', () => {
    const info = describeAuthLink(ATTACKER_LINK);
    expect(info).toMatchObject({ allowed: true, kind: 'tokens', email: 'attacker@evil.test' });
  });

  it('recognises the PKCE grant and admits it cannot name the account', () => {
    const info = describeAuthLink('lanternstudy://verify-email?code=pkce-123');
    expect(info).toMatchObject({ kind: 'code', email: null });
  });

  it('surfaces gotrue error codes instead of dropping them', () => {
    const info = describeAuthLink('lanternstudy://reset-password#error_code=otp_expired');
    expect(info.errorCode).toBe('otp_expired');
    expect(info.kind).toBeNull();
    expect(isAllowedMobileAuthUrl('lanternstudy://reset-password#error_code=otp_expired')).toBe(true);
  });

  it('refuses to treat any other deep link as a session-setter', () => {
    // Tokens glued onto an unrelated path used to make it an "auth URL".
    const info = describeAuthLink(
      `lanternstudy://jobs/123?access_token=${accessTokenFor('a@b.test')}&refresh_token=r`
    );
    expect(info.allowed).toBe(true);
    expect(info.kind).toBeNull();
    expect(isAllowedMobileAuthUrl('lanternstudy://jobs/123')).toBe(false);
  });

  it('parses nothing out of a link that failed the allowlist', () => {
    const info = describeAuthLink(
      `evil://reset-password#access_token=${accessTokenFor('a@b.test')}&refresh_token=r`
    );
    expect(info).toEqual({ allowed: false, kind: null, email: null, errorCode: null });
  });
});

describe('emailFromAccessToken', () => {
  it('decodes the claim, and stays quiet on anything malformed', () => {
    expect(emailFromAccessToken(accessTokenFor('ada@unilag.edu.ng'))).toBe('ada@unilag.edu.ng');
    expect(emailFromAccessToken('not-a-jwt')).toBeNull();
    expect(emailFromAccessToken('a.!!!.c')).toBeNull();
  });
});

describe('planAuthDeepLink', () => {
  it('requires a confirmation before any session is established', () => {
    expect(planAuthDeepLink(ATTACKER_LINK, {})).toEqual({
      action: 'confirm-sign-in',
      kind: 'tokens',
      email: 'attacker@evil.test',
    });
  });

  it('drops a link that failed the allowlist', () => {
    expect(planAuthDeepLink('evil://reset-password#access_token=x&refresh_token=y', {})).toEqual({
      action: 'ignore',
      reason: 'not-allowed',
    });
  });

  it('drops a non-auth deep link', () => {
    expect(planAuthDeepLink('lanternstudy://jobs/123', {})).toEqual({
      action: 'ignore',
      reason: 'not-an-auth-link',
    });
  });

  it('offers a sign-out rather than switching accounts behind the student', () => {
    const plan = planAuthDeepLink(ATTACKER_LINK, {
      userId: 'u-student',
      email: 'ada@unilag.edu.ng',
    });
    expect(plan).toEqual({
      action: 'confirm-sign-out-first',
      kind: 'tokens',
      email: 'attacker@evil.test',
      currentEmail: 'ada@unilag.edu.ng',
    });
  });

  it('treats a PKCE link as another account while somebody is signed in', () => {
    // The link cannot name its account, so it cannot be assumed to be ours.
    expect(
      planAuthDeepLink('lanternstudy://verify-email?code=pkce-1', {
        userId: 'u-student',
        email: 'ada@unilag.edu.ng',
      }).action
    ).toBe('confirm-sign-out-first');
  });

  it('does nothing when the link is for the account already signed in', () => {
    const link = `lanternstudy://verify-email#access_token=${accessTokenFor(
      'Ada@Unilag.edu.ng'
    )}&refresh_token=r`;
    expect(
      planAuthDeepLink(link, { userId: 'u-student', email: 'ada@unilag.edu.ng' }).action
    ).toBe('already-signed-in');
  });

  it('shows an expired link rather than failing silently', () => {
    expect(planAuthDeepLink('lanternstudy://reset-password#error_code=otp_expired', {})).toEqual({
      action: 'show-error',
      errorCode: 'otp_expired',
    });
  });
});

describe('planInviteDeepLink', () => {
  it('asks before joining a group from a link', () => {
    expect(planInviteDeepLink('lanternstudy://?inviteId=inv-1', null, 'u-1')).toEqual({
      action: 'confirm-join',
      inviteId: 'inv-1',
    });
  });

  it('takes the id the shared parser found on a path-form invite', () => {
    expect(
      planInviteDeepLink('https://lanternstudy.com/invite/tok-9', 'tok-9', 'u-1')
    ).toEqual({ action: 'confirm-join', inviteId: 'tok-9' });
  });

  it('ignores an invite from a site that is not ours', () => {
    expect(planInviteDeepLink('https://evil.test/?inviteId=inv-1', null, 'u-1')).toEqual({
      action: 'ignore',
      reason: 'not-allowed',
    });
  });

  it('ignores an invite when nobody is signed in', () => {
    expect(planInviteDeepLink('lanternstudy://?inviteId=inv-1', null, undefined)).toEqual({
      action: 'ignore',
      reason: 'signed-out',
    });
  });

  it('ignores a link carrying no invite', () => {
    expect(planInviteDeepLink('lanternstudy://jobs/1', null, 'u-1')).toEqual({
      action: 'ignore',
      reason: 'no-invite',
    });
  });
});

describe('inviteIdFromUrl', () => {
  it('reads the query form only from an allowlisted URL', () => {
    expect(inviteIdFromUrl('lanternstudy://?inviteId=inv-1')).toBe('inv-1');
    expect(inviteIdFromUrl('https://lanternstudy.com/?inviteId=inv-2')).toBe('inv-2');
    expect(inviteIdFromUrl('https://evil.test/?inviteId=inv-3')).toBeNull();
    expect(inviteIdFromUrl('lanternstudy://?inviteId=')).toBeNull();
  });
});
