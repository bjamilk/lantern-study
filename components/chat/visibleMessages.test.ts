/**
 * Unit tests for the conversation's visibility rules (lane M8, step 4).
 *
 * This is the half of ChatWindow that decides what a student can see, and until
 * it came out of the component nothing could reach it: the rules lived inside a
 * `useMemo` inside a 2,783-line function. They are pure now, so each rule gets
 * the test it always should have had — including the two group-only rules,
 * which applied to a DM would hide half of a marketplace negotiation.
 */
import { describe, expect, it } from 'vitest';
import { selectVisibleMessages, selectVisibleThreadMessages } from './visibleMessages';
import type { Message } from '../../types';

const message = (over: Partial<Message> = {}): Message =>
  ({
    id: 'm1',
    text: 'Hello',
    timestamp: '2026-09-15T10:00:00.000Z',
    sender: { id: 'u1', name: 'Ada' },
    ...over,
  }) as Message;

const visible = (messages: Message[], over: Partial<Parameters<typeof selectVisibleMessages>[0]> = {}) =>
  selectVisibleMessages({
    messages,
    isGroupChat: true,
    questionVisibilityMode: 'all',
    starredOnly: false,
    starredIds: new Set<string>(),
    threadSearch: '',
    ...over,
  }).map((m) => m.id);

describe('selectVisibleMessages', () => {
  it('keeps everything when nothing is filtering', () => {
    expect(visible([message({ id: 'a' }), message({ id: 'b' })])).toEqual(['a', 'b']);
  });

  it('hides an archived message in a group, and only in a group', () => {
    const messages = [message({ id: 'a' }), message({ id: 'b', isArchived: true } as never)];
    expect(visible(messages)).toEqual(['a']);
    expect(visible(messages, { isGroupChat: false })).toEqual(['a', 'b']);
  });

  it('hides a removed message, unless something replies to it', () => {
    const removed = message({ id: 'a', isRemoved: true } as never);
    expect(visible([removed])).toEqual([]);
    const reply = message({ id: 'b', replyToMessageId: 'a' } as never);
    expect(visible([removed, reply])).toEqual(['a', 'b']);
    // A reply that was itself removed does not keep the parent alive.
    const removedReply = message({ id: 'c', replyToMessageId: 'a', isRemoved: true } as never);
    expect(visible([removed, removedReply])).toEqual([]);
  });

  it('applies the question-visibility mode to a group only', () => {
    const messages = [
      message({ id: 'plain' }),
      message({ id: 'q', type: 'QUESTION', questionStatus: 'VERIFIED' } as never),
    ];
    expect(visible(messages, { questionVisibilityMode: 'all' })).toEqual(['plain', 'q']);
    // 'none' is the mode that hides questions from the conversation.
    expect(visible(messages, { questionVisibilityMode: 'none' })).toEqual(['plain']);
    expect(visible(messages, { questionVisibilityMode: 'unverified' })).toEqual(['plain']);
    // A DM has no question mode at all.
    expect(visible(messages, { questionVisibilityMode: 'none', isGroupChat: false })).toEqual([
      'plain',
      'q',
    ]);
  });

  it('keeps a pending question visible in every mode but none, so members can vote', () => {
    const pending = [message({ id: 'q', type: 'QUESTION', questionStatus: 'PENDING' } as never)];
    expect(visible(pending, { questionVisibilityMode: 'verified' })).toEqual(['q']);
    expect(visible(pending, { questionVisibilityMode: 'unverified' })).toEqual(['q']);
    expect(visible(pending, { questionVisibilityMode: 'none' })).toEqual([]);
  });

  it('narrows to starred messages in the starred-only view', () => {
    const messages = [message({ id: 'a' }), message({ id: 'b' })];
    expect(visible(messages, { starredOnly: true, starredIds: new Set(['b']) })).toEqual(['b']);
    expect(visible(messages, { starredOnly: false, starredIds: new Set(['b']) })).toEqual([
      'a',
      'b',
    ]);
  });

  it('searches the text and the question stem, case-insensitively', () => {
    const messages = [
      message({ id: 'a', text: 'The Krebs cycle' }),
      message({ id: 'b', text: 'Unrelated' }),
      message({ id: 'c', text: '', questionStem: 'Which step of KREBS yields NADH?' } as never),
    ];
    expect(visible(messages, { threadSearch: 'krebs' })).toEqual(['a', 'c']);
    expect(visible(messages, { threadSearch: '  Krebs  ' })).toEqual(['a', 'c']);
  });

  it('ignores a search of fewer than two characters', () => {
    const messages = [message({ id: 'a', text: 'Krebs' }), message({ id: 'b', text: 'Other' })];
    expect(visible(messages, { threadSearch: 'k' })).toEqual(['a', 'b']);
    expect(visible(messages, { threadSearch: ' ' })).toEqual(['a', 'b']);
  });

  it('applies the filters together, not in the alternative', () => {
    const messages = [
      message({ id: 'a', text: 'Krebs cycle' }),
      message({ id: 'b', text: 'Krebs again' }),
      message({ id: 'c', text: 'Glycolysis' }),
    ];
    expect(
      visible(messages, { threadSearch: 'krebs', starredOnly: true, starredIds: new Set(['b']) })
    ).toEqual(['b']);
  });

  it('returns a new array and never mutates the input', () => {
    const messages = [message({ id: 'a' }), message({ id: 'b', isArchived: true } as never)];
    const before = messages.map((m) => m.id);
    selectVisibleMessages({
      messages,
      isGroupChat: true,
      questionVisibilityMode: 'all',
      starredOnly: false,
      starredIds: new Set<string>(),
      threadSearch: '',
    });
    expect(messages.map((m) => m.id)).toEqual(before);
  });
});

describe('selectVisibleThreadMessages', () => {
  it('applies only the archived and removed rules', () => {
    const messages = [
      message({ id: 'a' }),
      message({ id: 'b', isArchived: true } as never),
      message({ id: 'c', isRemoved: true } as never),
    ];
    expect(selectVisibleThreadMessages(messages, true).map((m) => m.id)).toEqual(['a']);
  });

  it('keeps an archived reply in a DM thread', () => {
    const messages = [message({ id: 'a', isArchived: true } as never)];
    expect(selectVisibleThreadMessages(messages, false).map((m) => m.id)).toEqual(['a']);
  });

  it('keeps a removed reply that something else replies to', () => {
    const messages = [
      message({ id: 'a', isRemoved: true } as never),
      message({ id: 'b', replyToMessageId: 'a' } as never),
    ];
    expect(selectVisibleThreadMessages(messages, true).map((m) => m.id)).toEqual(['a', 'b']);
  });
});
