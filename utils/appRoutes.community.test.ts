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
    expect(buildAppPath(AppMode.COMMUNITY_DETAIL, { groupId: 'g1' })).toBe('/discover');
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
