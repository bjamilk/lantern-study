/**
 * `authSessionRateLimit` was one IP-only counter, so every student behind a
 * campus NAT or a mobile carrier gateway shared a single 30-per-15-minutes
 * budget across /auth/exchange, /refresh, /session and /revoke-other-sessions.
 * Ordinary token refresh from a lecture hall exhausted it and signed the room
 * out — the limiter DoSing the people it was meant to protect.
 *
 * F10 keys it per session instead, with a wide per-IP counter in front (these
 * requests carry a credential, so they skip the anonymous IP tier entirely and
 * an attacker-controlled key on its own would be a free bypass).
 */
jest.mock('../services/redisStore', () => ({
  redisKey: (suffix: string) => `test:${suffix}`,
  getRedisClient: async () => null,
}));

import { authSessionBucketKey } from './rateLimit';

/** A JWT-shaped token whose payload carries `sub`. Never verified here. */
function jwtFor(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ sub, exp: 9e9 })).toString('base64url');
  return `header.${payload}.signature`;
}

function req(over: Record<string, unknown> = {}): any {
  return { headers: {}, cookies: {}, ip: '203.0.113.7', ...over };
}

describe('authSessionBucketKey', () => {
  it('gives two students on the SAME network different buckets', () => {
    const a = authSessionBucketKey(req({ headers: { authorization: `Bearer ${jwtFor('user-a')}` } }));
    const b = authSessionBucketKey(req({ headers: { authorization: `Bearer ${jwtFor('user-b')}` } }));
    expect(a).not.toBe(b);
    expect(a).toBe('sub:user-a');
  });

  it('keeps ONE bucket across a refresh, which rotates the token but not the subject', () => {
    const before = authSessionBucketKey(req({ cookies: { lantern_access: jwtFor('user-a') } }));
    const after = authSessionBucketKey(
      req({ cookies: { lantern_access: `header.${Buffer.from(JSON.stringify({ sub: 'user-a', exp: 9e9 })).toString('base64url')}.DIFFERENT` } })
    );
    expect(before).toBe(after);
  });

  it('reads the bearer header, the access cookie and the refresh cookie, in that order', () => {
    expect(
      authSessionBucketKey(
        req({
          headers: { authorization: `Bearer ${jwtFor('from-header')}` },
          cookies: { lantern_access: jwtFor('from-cookie') },
        })
      )
    ).toBe('sub:from-header');
    expect(authSessionBucketKey(req({ cookies: { lantern_access: jwtFor('from-cookie') } }))).toBe(
      'sub:from-cookie'
    );
    expect(authSessionBucketKey(req({ cookies: { lantern_refresh: jwtFor('from-refresh') } }))).toBe(
      'sub:from-refresh'
    );
  });

  it('falls back to the IP for anything it cannot read a subject from', () => {
    // Otherwise a malformed credential would mint a fresh bucket per request.
    const ip = authSessionBucketKey(req());
    expect(authSessionBucketKey(req({ headers: { authorization: 'Bearer garbage' } }))).toBe(ip);
    expect(authSessionBucketKey(req({ cookies: { lantern_access: 'a.b' } }))).toBe(ip);
    expect(
      authSessionBucketKey(req({ cookies: { lantern_access: `header.${Buffer.from('{not json').toString('base64url')}.sig` } }))
    ).toBe(ip);
    expect(
      authSessionBucketKey(req({ cookies: { lantern_access: `header.${Buffer.from(JSON.stringify({ sub: 42 })).toString('base64url')}.sig` } }))
    ).toBe(ip);
  });

  it('ignores an absurdly long credential rather than hashing it into a bucket', () => {
    const ip = authSessionBucketKey(req());
    expect(authSessionBucketKey(req({ headers: { authorization: `Bearer ${'x'.repeat(5000)}` } }))).toBe(ip);
  });
});
