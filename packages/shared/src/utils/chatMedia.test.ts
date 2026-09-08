import {
  CHAT_MESSAGE_MUTATION_WINDOW_MS,
  canEditChatMessage,
  canRemoveChatMessage,
  deleteBlockedReason,
  isChatMessageMutationWindowOpen,
  shouldRenderRemovedMessage,
} from './chatMedia';

describe('chat message mutation rules', () => {
  const now = Date.parse('2026-07-23T12:30:00.000Z');
  const sentAt = '2026-07-23T12:00:00.000Z';

  it('closes the window after 30 minutes from the original send time', () => {
    expect(isChatMessageMutationWindowOpen(sentAt, now)).toBe(true);
    expect(
      isChatMessageMutationWindowOpen(sentAt, now + CHAT_MESSAGE_MUTATION_WINDOW_MS + 1)
    ).toBe(false);
  });

  it('allows only the sender to edit ordinary text', () => {
    const message = {
      id: 'message-1',
      senderId: 'user-1',
      timestamp: sentAt,
      type: 'TEXT',
      text: 'Original',
      editedAt: '2026-07-23T12:29:00.000Z',
    };

    expect(canEditChatMessage(message, 'user-1', now)).toBe(true);
    expect(canEditChatMessage(message, 'user-2', now)).toBe(false);
    expect(
      canEditChatMessage({ ...message, text: '[audio](https://example.com/note.m4a)' }, 'user-1', now)
    ).toBe(false);
    expect(canEditChatMessage({ ...message, type: 'QUESTION' }, 'user-1', now)).toBe(false);
  });

  it('allows the sender to remove a voice note within the window', () => {
    expect(
      canRemoveChatMessage(
        {
          id: 'message-1',
          senderId: 'user-1',
          timestamp: sentAt,
          type: 'TEXT',
          text: '[audio](https://example.com/note.m4a)',
        },
        'user-1',
        now
      )
    ).toBe(true);
  });
});

describe('deleteBlockedReason', () => {
  const now = Date.parse('2026-07-23T12:30:00.000Z');
  const sentAt = '2026-07-23T12:00:00.000Z';
  const own = {
    id: 'message-1',
    senderId: 'user-1',
    timestamp: sentAt,
    type: 'TEXT',
    text: 'Original',
  };

  it('gives no reason when the message is genuinely removable', () => {
    // Delete is offered, so there is nothing to explain — the greyed trash the
    // student saw becomes an enabled one here.
    expect(canRemoveChatMessage(own, 'user-1', now)).toBe(true);
    expect(deleteBlockedReason(own, 'user-1', now)).toBeUndefined();
  });

  it("stays silent about other people's messages (they get Report, not an excuse)", () => {
    expect(deleteBlockedReason(own, 'user-2', now)).toBeUndefined();
  });

  it('explains the closed 30-minute window on your own text', () => {
    const stale = now + CHAT_MESSAGE_MUTATION_WINDOW_MS + 1;
    expect(canRemoveChatMessage(own, 'user-1', stale)).toBe(false);
    expect(deleteBlockedReason(own, 'user-1', stale)).toBe(
      'Messages can only be deleted within 30 minutes of sending.'
    );
  });

  it('explains why a shared question cannot be pulled back', () => {
    const question = { ...own, type: 'QUESTION' };
    expect(deleteBlockedReason(question, 'user-1', now)).toBe(
      'Questions cannot be deleted once shared — the group may already be practising with them.'
    );
  });

  it('gives no reason for an already-removed message', () => {
    const stale = now + CHAT_MESSAGE_MUTATION_WINDOW_MS + 1;
    expect(
      deleteBlockedReason({ ...own, isRemoved: true }, 'user-1', stale)
    ).toBeUndefined();
  });
});

describe('removed message presentation', () => {
  const removed = {
    id: 'root',
    senderId: 'user-1',
    timestamp: '2026-07-23T12:00:00.000Z',
    type: 'TEXT',
    isRemoved: true,
  };

  it('hides a removed message with no visible replies', () => {
    expect(shouldRenderRemovedMessage(removed, [removed])).toBe(false);
  });

  it('keeps a tombstone when a visible reply depends on the message', () => {
    const reply = {
      id: 'reply',
      senderId: 'user-2',
      timestamp: '2026-07-23T12:01:00.000Z',
      type: 'TEXT',
      replyToMessageId: 'root',
    };
    expect(shouldRenderRemovedMessage(removed, [removed, reply])).toBe(true);
  });

  it('does not keep a tombstone only for another removed reply', () => {
    const removedReply = {
      id: 'reply',
      senderId: 'user-2',
      timestamp: '2026-07-23T12:01:00.000Z',
      type: 'TEXT',
      replyToMessageId: 'root',
      isRemoved: true,
    };
    expect(shouldRenderRemovedMessage(removed, [removed, removedReply])).toBe(false);
  });
});
