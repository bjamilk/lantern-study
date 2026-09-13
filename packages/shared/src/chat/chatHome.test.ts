import { buildChatHome, CHAT_HOME_COPY } from './chatHome';

describe('buildChatHome', () => {
  it('is first-run when there are no chats, and still surfaces lounges', () => {
    const home = buildChatHome({
      currentUserId: 'me',
      groups: [{ id: 'board', name: 'Announcements', communityId: 'c1', communitySurface: 'board' }],
      communities: [{ id: 'c1', slug: 'eng', name: 'Engineering', lounge_group_id: 'lounge-1' }],
    });
    expect(home.mode).toBe('firstRun');
    expect(home.conversationCount).toBe(0);
    expect(home.lounges).toEqual([
      { communityId: 'c1', slug: 'eng', name: 'Engineering', loungeGroupId: 'lounge-1' },
    ]);
    expect(CHAT_HOME_COPY.messageSomeone).toBe('Message someone');
  });

  it('ranks recents by last message and skips archived, boards, and inbound requests', () => {
    const home = buildChatHome({
      currentUserId: 'me',
      groups: [
        { id: 'g1', name: 'Chem', lastMessage: 'Lab at 4', lastMessageTime: '2026-09-12T12:00:00.000Z' },
        { id: 'g2', name: 'Old', lastMessage: 'bye', lastMessageTime: '2026-09-11T12:00:00.000Z', isArchived: true },
        { id: 'g3', name: 'Nested', parentId: 'g1', lastMessage: 'sub' },
      ],
      dmThreads: [
        {
          id: 'me-ada',
          participantIds: ['me', 'ada'],
          participants: { ada: { name: 'Ada', avatarUrl: 'a.png' } },
          lastMessage: 'Hey',
          lastMessageTimestamp: '2026-09-13T12:00:00.000Z',
        },
        {
          id: 'req',
          participantIds: ['me', 'bob'],
          participants: { bob: { name: 'Bob' } },
          status: 'pending',
          requestedBy: 'bob',
        },
      ],
      inquiries: [
        { id: 'i1', dm_thread_id: 'me-ada', status: 'open', listing: { title: 'Used calculator' } },
        { id: 'i2', dm_thread_id: 'x', status: 'closed', listing: { title: 'Sold' } },
      ],
    });
    expect(home.mode).toBe('inbox');
    expect(home.recents.map((r) => r.id)).toEqual(['me-ada', 'g1']);
    expect(home.recents[0]).toMatchObject({ name: 'Ada', preview: 'Hey', chatType: 'dm' });
    expect(home.inquiries).toEqual([{ id: 'i1', threadId: 'me-ada', title: 'Used calculator' }]);
  });
});
