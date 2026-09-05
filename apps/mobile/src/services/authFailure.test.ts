/**
 * The classifier is the only thing standing between a bad campus link and a
 * student losing their session (and, before this, their unsynced results), so
 * it is tested against the REAL auth-js error classes rather than hand-rolled
 * look-alikes — if supabase-js changes a name or a status, this suite fails
 * instead of the handset.
 */
import {
  AuthApiError,
  AuthError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  AuthUnknownError,
} from '@supabase/supabase-js';
import {
  classifyRefreshError,
  decideOn401,
  isDefinitiveAuthCode,
  type RefreshOutcome,
} from './authFailure';

describe('classifyRefreshError — transient (session must survive)', () => {
  it('treats auth-js AuthRetryableFetchError as transient', () => {
    expect(classifyRefreshError(new AuthRetryableFetchError('Network request failed', 0))).toBe(
      'transient'
    );
  });

  it('treats AuthUnknownError as transient (unparseable body, e.g. captive portal)', () => {
    expect(classifyRefreshError(new AuthUnknownError('Something went wrong', null))).toBe(
      'transient'
    );
  });

  it.each([0, 408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527])(
    'treats status %s as transient',
    (status) => {
      expect(classifyRefreshError(new AuthApiError('upstream said no', status, undefined))).toBe(
        'transient'
      );
    }
  );

  it.each([
    'Network request failed',
    'TypeError: Failed to fetch',
    'Request timed out',
    'socket timeout',
    'connect ECONNREFUSED 10.0.2.2:443',
    'getaddrinfo ENOTFOUND tiizkjhbrnaibaagmurl.supabase.co',
    'getaddrinfo EAI_AGAIN supabase.co',
    'The operation was aborted',
  ])('treats the message %p as transient', (message) => {
    expect(classifyRefreshError(new Error(message))).toBe('transient');
  });

  it('treats a transport message as transient even when it carries a 400', () => {
    // A proxy that answers 400 with "network request failed" must not be read
    // as proof that the refresh token is dead.
    expect(
      classifyRefreshError(new AuthApiError('network request failed', 400, 'invalid_grant'))
    ).toBe('transient');
  });

  it('treats a bare 400 with no code as transient (the API answers an expired JWT this way)', () => {
    expect(classifyRefreshError(new AuthApiError('Bad Request', 400, undefined))).toBe('transient');
  });

  it('treats an unrecognised gotrue code as transient', () => {
    expect(classifyRefreshError(new AuthApiError('nope', 400, 'over_email_send_rate_limit'))).toBe(
      'transient'
    );
  });

  it('treats a dead-token code WITHOUT a proving status as transient', () => {
    expect(classifyRefreshError(new AuthError('invalid grant', undefined, 'invalid_grant'))).toBe(
      'transient'
    );
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'boom'],
    ['a number', 42],
  ])('fails safe on %s', (_label, value) => {
    expect(classifyRefreshError(value)).toBe('transient');
  });

  it('fails safe on an unknown error object with no recognisable fields', () => {
    // The explicit default: nothing here proves anything, so keep the session.
    expect(classifyRefreshError({ weird: true, nested: { status: 400 } })).toBe('transient');
  });
});

describe('classifyRefreshError — invalid (positively proven dead)', () => {
  it.each([
    'refresh_token_not_found',
    'refresh_token_already_used',
    'invalid_grant',
    'session_not_found',
    'session_expired',
    'user_banned',
    'user_not_found',
  ])('treats a 400 with code %s as invalid', (code) => {
    expect(classifyRefreshError(new AuthApiError('Invalid Refresh Token', 400, code))).toBe(
      'invalid'
    );
  });

  it.each([401, 403])('treats status %s with a dead-token code as invalid', (status) => {
    expect(
      classifyRefreshError(new AuthApiError('Invalid Refresh Token', status, 'invalid_grant'))
    ).toBe('invalid');
  });

  it('treats AuthSessionMissingError as invalid (there is no session on this device)', () => {
    expect(classifyRefreshError(new AuthSessionMissingError())).toBe('invalid');
  });

  it('reads a gotrue REST body that spells the code error_code', () => {
    expect(classifyRefreshError({ status: 400, error_code: 'refresh_token_not_found' })).toBe(
      'invalid'
    );
  });
});

describe('isDefinitiveAuthCode', () => {
  it.each(['SESSION_REVOKED', 'ACCOUNT_BANNED', 'ACCOUNT_DEACTIVATED'])(
    'accepts %s',
    (code) => {
      expect(isDefinitiveAuthCode(code)).toBe(true);
    }
  );

  it.each([undefined, null, '', 'UNAUTHORIZED', 'session_revoked', 'ACCOUNT_SUSPENDED'])(
    'rejects %p',
    (code) => {
      expect(isDefinitiveAuthCode(code)).toBe(false);
    }
  );
});

describe('decideOn401', () => {
  it('signs out on a definitive server code, whatever the refresh did', () => {
    const outcomes: RefreshOutcome[] = ['refreshed', 'transient', 'invalid'];
    for (const refresh of outcomes) {
      expect(decideOn401({ authCode: 'SESSION_REVOKED', refresh })).toBe('sign-out');
    }
  });

  it('retries once when the refresh succeeded', () => {
    expect(decideOn401({ refresh: 'refreshed' })).toBe('retry');
  });

  it('stays offline — never signs out — when the refresh could not reach the server', () => {
    expect(decideOn401({ refresh: 'transient' })).toBe('stay-offline');
    expect(decideOn401({ authCode: undefined, refresh: 'transient' })).toBe('stay-offline');
  });

  it('signs out when the refresh proved the token is dead', () => {
    expect(decideOn401({ refresh: 'invalid' })).toBe('sign-out');
  });
});
