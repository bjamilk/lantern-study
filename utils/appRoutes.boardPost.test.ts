/**
 * `/discover/c/:slug/ch/:groupId/p/:postId` — the link Share puts on the
 * clipboard.
 *
 * Mobile has routed this shape since the board shipped; web parsed only two
 * segments deep, so a shared link opened the dashboard. These tests pin the
 * round trip in both directions, because the two halves are what make the link
 * work: `boardPostShareUrl` mints the path and `parseAppRoute` has to give the
 * same post id back.
 */
import { describe, expect, it } from 'vitest';
import { boardPostShareUrl } from '@lantern/shared/network';
import { AppMode } from '../types';
import { buildAppPath, parseAppRoute } from './appRoutes';

describe('board post links', () => {
  it('parses a post inside a board channel', () => {
    expect(parseAppRoute('/discover/c/unilag-med/ch/g1/p/m9')).toEqual({
      mode: AppMode.COMMUNITY_DETAIL,
      params: { slug: 'unilag-med', groupId: 'g1', postId: 'm9' },
    });
  });

  it('builds the post path only when a post id is given', () => {
    expect(buildAppPath(AppMode.COMMUNITY_DETAIL, { slug: 's', groupId: 'g1', postId: 'm9' })).toBe(
      '/discover/c/s/ch/g1/p/m9'
    );
    expect(buildAppPath(AppMode.COMMUNITY_DETAIL, { slug: 's', groupId: 'g1' })).toBe(
      '/discover/c/s/ch/g1'
    );
    // No board means no post: it falls back to the community, never to /chat.
    expect(buildAppPath(AppMode.COMMUNITY_DETAIL, { slug: 's', postId: 'm9' })).toBe(
      '/discover/c/s'
    );
  });

  it('round-trips the exact link the share sheet copies', () => {
    const url = boardPostShareUrl('unilag-med', 'g1', 'm9');
    expect(url).toBe('https://lanternstudy.com/discover/c/unilag-med/ch/g1/p/m9');
    expect(parseAppRoute(new URL(url).pathname)).toEqual({
      mode: AppMode.COMMUNITY_DETAIL,
      params: { slug: 'unilag-med', groupId: 'g1', postId: 'm9' },
    });
  });

  it('round-trips ids that need encoding', () => {
    const path = buildAppPath(AppMode.COMMUNITY_DETAIL, {
      slug: 'a b',
      groupId: 'x/y',
      postId: 'p q',
    });
    expect(path).toBe('/discover/c/a%20b/ch/x%2Fy/p/p%20q');
    expect(parseAppRoute(path!)).toEqual({
      mode: AppMode.COMMUNITY_DETAIL,
      params: { slug: 'a b', groupId: 'x/y', postId: 'p q' },
    });
  });

  it('falls back to the board when the post segment is malformed', () => {
    // A truncated paste still lands somewhere the reader can use.
    expect(parseAppRoute('/discover/c/s/ch/g1/p')).toEqual({
      mode: AppMode.COMMUNITY_DETAIL,
      params: { slug: 's', groupId: 'g1' },
    });
    expect(parseAppRoute('/discover/c/s/ch/g1/x/m9')).toEqual({
      mode: AppMode.COMMUNITY_DETAIL,
      params: { slug: 's', groupId: 'g1' },
    });
  });

  it('leaves the plain channel route exactly as it was', () => {
    expect(parseAppRoute('/discover/c/s/ch/g1')).toEqual({
      mode: AppMode.COMMUNITY_DETAIL,
      params: { slug: 's', groupId: 'g1' },
    });
    expect(parseAppRoute('/discover/c/s')).toEqual({
      mode: AppMode.COMMUNITY_DETAIL,
      params: { slug: 's' },
    });
  });

  it('never resolves a board link onto the chat screen', () => {
    const parsed = parseAppRoute('/discover/c/s/ch/g1/p/m9');
    expect(parsed.mode).not.toBe(AppMode.CHAT);
    expect(buildAppPath(parsed.mode!, parsed.params)).not.toContain('/chat/');
  });
});
