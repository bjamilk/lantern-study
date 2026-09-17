/**
 * Community server view (Phase 1 · §2.3 / §2.4).
 *
 * Pins the things that fail silently if broken: the two-segment routes the
 * clients call are registered on the communities router (a `/:slug` route
 * above them cannot swallow them because it is one segment), the roster
 * cursor round-trips and refuses garbage with a 400-class PublicError rather
 * than a 500 from a malformed PostgREST filter, and the role resolution the
 * detail and the roster share.
 */
jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'probe-user', permissions: [], credentialType: 'jwt' };
    next();
  },
}));
jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import router from './communities';
import { decodeMembersCursor, encodeMembersCursor } from '../services/communities';
import { PublicError } from '../utils/safeError';
import { resolveCommunityRole } from '@lantern/shared/network';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const registered = (r: any, method: 'get' | 'post' | 'put' | 'delete') =>
  r.stack.filter((layer: any) => layer.route?.methods?.[method]).map((layer: any) => layer.route.path);

describe('communities router', () => {
  it('registers GET /:communityId/channels next to /:communityId/members', () => {
    const gets = registered(router, 'get');
    expect(gets).toContain('/:communityId/channels');
    expect(gets).toContain('/:communityId/members');
    // Both are two segments: `/:slug` cannot shadow them.
    expect(gets).toContain('/:slug');
  });
});

describe('members cursor', () => {
  it('round-trips a Postgres timestamptz (microsecond precision, +00:00 offset) and a uuid', () => {
    const joinedAt = '2026-08-24T12:00:00.123456+00:00';
    const cursor = encodeMembersCursor(joinedAt, USER);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeMembersCursor(cursor)).toEqual({ joinedAt, userId: USER });
  });

  it('round-trips a Z-suffixed timestamp without fractional seconds', () => {
    const joinedAt = '2026-08-24T12:00:00Z';
    expect(decodeMembersCursor(encodeMembersCursor(joinedAt, OTHER))).toEqual({
      joinedAt,
      userId: OTHER,
    });
  });

  it.each([
    ['empty', ''],
    ['not base64url', 'abc/def=='],
    ['no separator', Buffer.from('2026-08-24T12:00:00Z', 'utf8').toString('base64url')],
    ['bad uuid', Buffer.from('2026-08-24T12:00:00Z|nope', 'utf8').toString('base64url')],
    ['bad timestamp', Buffer.from(`yesterday|${USER}`, 'utf8').toString('base64url')],
    [
      'filter injection in the timestamp',
      Buffer.from(`2026-08-24T12:00:00Z),user_id.gt.x|${USER}`, 'utf8').toString('base64url'),
    ],
    ['plain garbage', 'garbage'],
  ])('rejects a malformed cursor (%s) with a PublicError', (_label, cursor) => {
    expect(() => decodeMembersCursor(cursor)).toThrow(PublicError);
    expect(() => decodeMembersCursor(cursor)).toThrow('Invalid cursor');
  });
});

describe('resolveCommunityRole (shared, used by the detail and the roster)', () => {
  it('the creator is the owner whatever their stored role', () => {
    expect(resolveCommunityRole('member', USER, USER)).toBe('owner');
    expect(resolveCommunityRole('admin', USER, USER)).toBe('owner');
  });

  it('admin and moderator pass through for everyone else', () => {
    expect(resolveCommunityRole('admin', OTHER, USER)).toBe('admin');
    expect(resolveCommunityRole('moderator', OTHER, USER)).toBe('moderator');
  });

  it('anything else is a plain member (derived scope communities have no creator)', () => {
    expect(resolveCommunityRole('member', OTHER, USER)).toBe('member');
    expect(resolveCommunityRole(null, OTHER, null)).toBe('member');
    expect(resolveCommunityRole(undefined, OTHER, undefined)).toBe('member');
    expect(resolveCommunityRole('owner', OTHER, USER)).toBe('member');
  });
});
