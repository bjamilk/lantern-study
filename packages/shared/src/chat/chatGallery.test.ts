import { collectChatGalleryItems } from './chatGallery';
import { chatDraftStorageKey, chatDraftIsEmpty } from './chatDrafts';
import { chatMatchesInboxFilter, chatRowSubtitle } from './chatInbox';
import { firstLinkPreviewUrl, linkPreviewHostname } from './linkPreview';

describe('collectChatGalleryItems', () => {
  it('keeps photos and voice notes, skips removed rows', () => {
    const items = collectChatGalleryItems([
      { id: '1', text: '![image](https://cdn.example/p.jpg)', timestamp: '2026-01-01' },
      { id: '2', text: '[audio](https://cdn.example/a.m4a)' },
      { id: '3', text: 'hello' },
      { id: '4', text: '![image](https://cdn.example/gone.jpg)', isRemoved: true },
    ]);
    expect(items.map((i) => i.kind)).toEqual(['photo', 'voice']);
  });
});

describe('chat drafts and inbox', () => {
  it('keys a draft per conversation', () => {
    expect(chatDraftStorageKey('dm', 'a-b')).toBe('lantern_chat_draft:dm:a-b');
    expect(chatDraftIsEmpty('   ')).toBe(true);
  });

  it('filters unread and labels lounge / request rows', () => {
    expect(chatMatchesInboxFilter(0, 'unread')).toBe(false);
    expect(chatMatchesInboxFilter(2, 'unread')).toBe(true);
    expect(chatRowSubtitle({ kind: 'request' })).toBe('Message request');
    expect(chatRowSubtitle({ kind: 'lounge', communityName: 'Engineering', preview: 'hi' })).toBe(
      'in Engineering · hi',
    );
  });
});

describe('link preview', () => {
  it('picks the first http(s) url and strips www', () => {
    expect(firstLinkPreviewUrl('see https://www.lanternstudy.com/notes hi')).toBe(
      'https://www.lanternstudy.com/notes',
    );
    expect(linkPreviewHostname('https://www.lanternstudy.com/notes')).toBe('lanternstudy.com');
  });
});

import { findInquiryRecord, resolveInquiryDmTarget } from './inquiryChat';
import { chatStarredStorageKey, parseStoredIdSet } from './chatLocalMarks';
import { feedItemNavTarget, remapFeedTargetForBoard } from '../network/feedNav';

describe('inquiry DM target', () => {
  it('picks the other person and the stored thread', () => {
    expect(
      resolveInquiryDmTarget({
        viewerId: 'buyer',
        inquiryId: 'inq-1',
        threadId: 't1',
        buyerId: 'buyer',
        sellerId: 'seller',
      }),
    ).toEqual({ inquiryId: 'inq-1', threadId: 't1', otherUserId: 'seller' });
    expect(
      findInquiryRecord(
        [{ id: 'inq-1', dm_thread_id: 't1', buyer_id: 'buyer' }],
        { inquiryId: 'inq-1' },
      )?.dm_thread_id,
    ).toBe('t1');
  });
});

describe('local chat marks', () => {
  it('uses the same keys as mobile stars', () => {
    expect(chatStarredStorageKey('u1', 'dm', 't1')).toBe('lantern_starred_msgs:u1:dm:t1');
    expect(parseStoredIdSet('["a","b"]')).toEqual(new Set(['a', 'b']));
  });
});

describe('feed navigation', () => {
  it('opens a board post from a discover path', () => {
    expect(
      feedItemNavTarget({
        objectType: 'community_post',
        objectId: 'p1',
        payload: { link: '/discover/c/eng/ch/g1/p/p1' },
      }),
    ).toEqual({
      screen: 'CommunityPost',
      params: { slug: 'eng', groupId: 'g1', id: 'p1' },
    });
  });

  it('remaps a board question onto the post', () => {
    expect(
      remapFeedTargetForBoard(
        { screen: 'GroupChat', params: { groupId: 'g1', messageId: 'p1' } },
        {
          isBoardGroup: (id) => id === 'g1',
          communitySlugForGroup: () => 'eng',
        },
      ),
    ).toEqual({
      screen: 'CommunityPost',
      params: { slug: 'eng', groupId: 'g1', id: 'p1' },
    });
  });
});
