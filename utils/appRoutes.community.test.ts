import { describe, expect, it } from 'vitest';
import { AppMode } from '../types';
import { buildAppPath, parseAppRoute } from './appRoutes';

describe('community server routes', () => {
  it('parses the community home', () => {
    expect(parseAppRoute('/discover/c/unilag-med')).toEqual({
      mode: AppMode.COMMUNITY_DETAIL,
      params: { slug: 'unilag-med' },
    });
  });

  it('parses a channel inside the community as COMMUNITY_DETAIL, never CHAT', () => {
    expect(parseAppRoute('/discover/c/unilag-med/ch/abc-123')).toEqual({
      mode: AppMode.COMMUNITY_DETAIL,
      params: { slug: 'unilag-med', groupId: 'abc-123' },
    });
  });

  it('ignores an unknown sub-path under the community', () => {
    expect(parseAppRoute('/discover/c/unilag-med/members')).toEqual({
      mode: AppMode.COMMUNITY_DETAIL,
      params: { slug: 'unilag-med' },
    });
    expect(parseAppRoute('/discover/c/unilag-med/ch')).toEqual({
      mode: AppMode.COMMUNITY_DETAIL,
      params: { slug: 'unilag-med' },
    });
  });

  it('builds the channel path only when a groupId is given', () => {
    expect(buildAppPath(AppMode.COMMUNITY_DETAIL, { slug: 'unilag-med' })).toBe('/discover/c/unilag-med');
    expect(buildAppPath(AppMode.COMMUNITY_DETAIL, { slug: 'unilag-med', groupId: 'g1' })).toBe(
      '/discover/c/unilag-med/ch/g1'
    );
    // No slug = no community to open, so it falls back to the Campus
    // destination the community lives under (it used to be `/discover`, which
    // is now one of the redirects into it).
    expect(buildAppPath(AppMode.COMMUNITY_DETAIL, { groupId: 'g1' })).toBe('/campus');
  });

  it('round-trips encoded slugs and ids', () => {
    const path = buildAppPath(AppMode.COMMUNITY_DETAIL, { slug: 'a b', groupId: 'x/y' });
    expect(path).toBe('/discover/c/a%20b/ch/x%2Fy');
    expect(parseAppRoute(path!)).toEqual({
      mode: AppMode.COMMUNITY_DETAIL,
      params: { slug: 'a b', groupId: 'x/y' },
    });
  });

  it('leaves the chat screen group path untouched', () => {
    expect(parseAppRoute('/chat/group/g1')).toEqual({
      mode: AppMode.CHAT,
      params: { groupId: 'g1' },
    });
  });
});

describe('the community modals that have URLs', () => {
  it('parses /discover/new onto the Communities surface with the create modal', () => {
    const route = parseAppRoute('/discover/new');
    expect(route.mode).toBe(AppMode.DISCOVER);
    expect(route.params.communityAction).toBe('create');
    expect(route.params.campusSegment).toBe('communities');
    // No redirect: a redirect to /campus would strip the action before the
    // screen ever saw it.
    expect(route.redirect).toBeUndefined();
  });

  it('parses an invite link into the join modal, carrying the code', () => {
    const route = parseAppRoute('/discover/join/unilag-pharmacy');
    expect(route.mode).toBe(AppMode.DISCOVER);
    expect(route.params.communityAction).toBe('join');
    expect(route.params.communityCode).toBe('unilag-pharmacy');
  });

  it('opens the box with no code rather than bouncing a mangled link', () => {
    const route = parseAppRoute('/discover/join');
    expect(route.params.communityAction).toBe('join');
    expect(route.params.communityCode).toBeUndefined();
  });

  it('round-trips both through buildAppPath', () => {
    expect(buildAppPath(AppMode.DISCOVER, { communityAction: 'create' })).toBe('/discover/new');
    expect(buildAppPath(AppMode.DISCOVER, { communityAction: 'join', communityCode: 'chess-club' })).toBe(
      '/discover/join/chess-club'
    );
    expect(buildAppPath(AppMode.DISCOVER, {})).toBe('/campus');
  });

  it('still routes a community slug that begins with the same letters', () => {
    expect(parseAppRoute('/discover/c/new-students').params.slug).toBe('new-students');
  });
});
