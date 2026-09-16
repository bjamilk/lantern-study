/**
 * Render smoke test for the thread side panel (lane M8b, step 2).
 *
 * The panel has one decision worth pinning and it is not about markup: WHEN a
 * reader is allowed to reply. A thread whose root message was removed is
 * closed — it takes no new replies and says so — and an archived group closes
 * every thread in it without that explanation, because the group is what is
 * archived, not the thread. Those two conditions sit in two sibling ternaries
 * that would look identical in review if one of them were inverted.
 *
 * The rest is the panel's contract with the reader: it is a labelled dialog
 * with a close button, it counts REPLIES (root excluded, so a thread with only
 * its root reads "0 replies"), and it renders one row per thread message.
 *
 * `MessageItem` and `MessageInputBar` are stubbed: both are large, both have
 * their own coverage, and what this file is asking is how many rows the panel
 * renders and whether a composer is there at all.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ThreadPanel, type ThreadPanelProps } from './ThreadPanel';

vi.mock('../MessageItem', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="thread-message" data-id={String((props.message as { id: string }).id)} />
  ),
}));
vi.mock('../MessageInputBar', () => ({
  default: () => <div data-testid="thread-composer" />,
}));

const noop = () => {};

const message = (id: string) =>
  ({
    id,
    text: id,
    timestamp: '2026-09-15T10:00:00.000Z',
    sender: { id: 'u2', name: 'Chidi Nwosu' },
  }) as never;

const baseProps: ThreadPanelProps = {
  threadRootId: 'm1',
  chat: { id: 'g1', chatType: 'group', name: 'Pharmacology 301' } as never,
  currentUser: { id: 'u1', name: 'Ada Ogundele' } as never,
  group: null,
  communityHost: false,
  isArchived: false,
  isThreadRootRemoved: false,
  threadLoading: false,
  visibleThreadMessages: [message('m1'), message('m2'), message('m3')],
  threadMessages: [message('m1'), message('m2'), message('m3')],
  threadReplyTo: null,
  threadEditingMessage: null,
  threadSeedMentionUsername: null,
  threadScrollRef: { current: null },
  threadEndRef: { current: null },
  threadCloseButtonRef: { current: null },
  threadMessageNodeRefs: { current: {} },
  userVotes: {},
  myReactions: {},
  starredIds: new Set<string>(),
  pinnedMessageId: null,
  mentionCandidates: [],
  setThreadRootId: noop,
  setThreadReplyTo: noop,
  setThreadEditingMessage: noop,
  setThreadSeedMentionUsername: noop,
  setForwardMessage: noop,
  setReportTarget: noop,
  handleThreadSend: noop,
  handleToggleReaction: noop,
  handleCopyMessage: noop,
  handleToggleStar: noop,
  handleTogglePin: noop,
  beginEditingMessage: noop,
  handleRemoveMessage: noop,
  onVoteQuestion: noop,
  onFlagAsSimilar: noop,
};

const render = (props: Partial<ThreadPanelProps> = {}) =>
  renderToStaticMarkup(<ThreadPanel {...baseProps} {...props} />);

const rows = (html: string) => (html.match(/data-testid="thread-message"/g) || []).length;

describe('ThreadPanel', () => {
  it('renders nothing when no thread is open', () => {
    expect(render({ threadRootId: null })).toBe('');
  });

  it('is a labelled dialog with a close button', () => {
    const html = render();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="chat-thread-title"');
    expect(html).toContain('aria-label="Close thread"');
  });

  it('renders a row per thread message and counts REPLIES, not messages', () => {
    const html = render();
    expect(rows(html)).toBe(3);
    // Three messages: the root plus two replies.
    expect(html).toContain('2');
    expect(html).toContain('replies');
  });

  it('says "reply" in the singular for a thread with one', () => {
    const html = render({ visibleThreadMessages: [message('m1'), message('m2')] });
    expect(html).toContain('reply');
    expect(html).not.toContain('replies');
  });

  it('shows a spinner instead of rows while the thread loads', () => {
    const html = render({ threadLoading: true });
    expect(rows(html)).toBe(0);
    expect(html).toContain('animate-spin');
  });

  it('offers a composer on an open thread', () => {
    expect(render()).toContain('data-testid="thread-composer"');
  });

  it('closes the thread when its root message was removed, and explains why', () => {
    const html = render({ isThreadRootRemoved: true });
    expect(html).not.toContain('data-testid="thread-composer"');
    expect(html).toContain('This thread is closed because its original message was removed.');
  });

  it('takes no replies in an archived group, and does not blame the root', () => {
    const html = render({ isArchived: true });
    expect(html).not.toContain('data-testid="thread-composer"');
    expect(html).not.toContain('original message was removed');
  });
});
