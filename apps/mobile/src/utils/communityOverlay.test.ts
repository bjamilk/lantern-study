import { decorateChannels, communityUnreadTotal } from '@lantern/shared/network';
import type { CommunityChannel } from '@lantern/shared/network';
import { findMyCommunity, toChannelOverlayGroups } from './communityOverlay';

const channel = (over: Partial<CommunityChannel> = {}): CommunityChannel => ({
  id: 'g1',
  name: 'exam-week',
  description: null,
  avatarUrl: null,
  memberCount: 4,
  questionCount: 0,
  visibility: 'community',
  courseId: null,
  isLounge: false,
  isMember: true,
  unreadCount: 0,
  lastMessage: 'server preview',
  lastMessageTime: '2026-09-01T00:00:00.000Z',
  ...over,
});

describe('toChannelOverlayGroups', () => {
  it('flattens the mobile message object into the shared preview string', () => {
    const [g] = toChannelOverlayGroups([
      {
        id: 'g1',
        unreadCount: 3,
        lastMessage: { text: 'hello there', createdAt: '2026-09-02T10:00:00.000Z' },
      },
    ]);
    expect(g.lastMessage).toBe('hello there');
    expect(g.lastMessageTime).toBe('2026-09-02T10:00:00.000Z');
    expect(g.unreadCount).toBe(3);
  });

  it('prefers the question stem for question messages and passes strings through', () => {
    const [q, s] = toChannelOverlayGroups([
      { id: 'q', lastMessage: { text: '', questionStem: 'What is 2+2?' } },
      { id: 's', lastMessage: 'plain' },
    ]);
    expect(q.lastMessage).toBe('What is 2+2?');
    expect(s.lastMessage).toBe('plain');
  });

  it('never renders "[object Object]" through decorateChannels', () => {
    const groups = toChannelOverlayGroups([
      { id: 'g1', unreadCount: 2, lastMessage: { text: 'live', createdAt: '2026-09-02T00:00:00.000Z' } },
    ]);
    const [decorated] = decorateChannels([channel()], groups);
    expect(decorated.lastMessage).toBe('live');
    expect(decorated.unreadCount).toBe(2);
    expect(String(decorated.lastMessage)).not.toContain('[object');
  });

  it('keeps the server preview when the store has no message yet', () => {
    const groups = toChannelOverlayGroups([{ id: 'g1', unreadCount: 0 }]);
    const [decorated] = decorateChannels([channel()], groups);
    expect(decorated.lastMessage).toBe('server preview');
  });

  it('feeds communityUnreadTotal with archived groups excluded', () => {
    const groups = toChannelOverlayGroups([
      { id: 'a', communityId: 'c1', unreadCount: 2 },
      { id: 'b', communityId: 'c1', unreadCount: 5, isArchived: true },
      { id: 'c', communityId: 'c2', unreadCount: 9 },
    ]);
    expect(communityUnreadTotal(groups, 'c1')).toBe(2);
  });
});

describe('findMyCommunity', () => {
  const mine = [
    { id: 'c1', slug: 'unilag', name: 'UNILAG' },
    { id: 'c2', slug: 'anatomy', name: 'Anatomy' },
  ];
  it('resolves a community id to its slug and name', () => {
    expect(findMyCommunity(mine, 'c2')).toEqual({ slug: 'anatomy', name: 'Anatomy' });
  });
  it('returns null for unknown or missing ids', () => {
    expect(findMyCommunity(mine, 'nope')).toBeNull();
    expect(findMyCommunity(mine, null)).toBeNull();
    expect(findMyCommunity(mine, undefined)).toBeNull();
  });

  it('returns a fresh object each call, so callers must memoize it', () => {
    // Used directly as a zustand selector this froze the app: a new object
    // every render is a changed snapshot forever, so React re-rendered without
    // end and the chat screen stopped responding. Subscribe to the array and
    // derive with useMemo instead.
    const mine = [{ id: 'c2', slug: 'anatomy', name: 'Anatomy' }];
    const a = findMyCommunity(mine, 'c2');
    const b = findMyCommunity(mine, 'c2');
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});
