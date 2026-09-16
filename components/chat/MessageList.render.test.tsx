/**
 * Render smoke test for the scrolling message list (lane M8, step 3).
 *
 * The list has one job with messages (render a row each, in order) and four
 * without (four different empty states, chosen in a fixed order of precedence),
 * plus the "N new messages" pill. That precedence is the part worth pinning:
 * an archived group must say it is archived even while a search is open, and
 * "No matches" must win over "No messages yet" — swapping those ternaries would
 * change what a student reads without changing anything visible in review.
 *
 * `MessageRow` is stubbed: it has its own test, and what this file is asking is
 * how many rows the list renders and with what neighbours.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MessageList, type MessageListProps } from './MessageList';

vi.mock('./MessageRow', () => ({
  MessageRow: (props: Record<string, unknown>) => (
    <div
      data-testid="row"
      data-id={String((props.message as { id: string }).id)}
      data-prev={String((props.previousMessage as { id: string } | null)?.id ?? 'none')}
      data-first-unread={String(props.isFirstUnread)}
      data-starred={String(props.starred)}
    />
  ),
}));

const noop = () => {};

const message = (id: string) =>
  ({ id, text: id, timestamp: '2026-09-15T10:00:00.000Z', sender: { id: 'u1' } }) as never;

const baseProps: MessageListProps = {
  visibleMessages: [],
  messagesContainerRef: { current: null },
  messagesEndRef: { current: null },
  firstUnreadRef: { current: null },
  handleScroll: noop,
  isLoadingMore: false,
  awaitingMessages: false,
  newMessagesBelow: 0,
  scrollToBottom: noop,
  firstUnreadId: null,
  isArchived: false,
  isGroup: true,
  starredOnly: false,
  threadSearch: '',
  name: 'Pharmacology 301',
  userVotes: {},
  myReactions: {},
  starredIds: new Set<string>(),
  pinnedMessageId: null,
  registerNode: noop,
  onScrollToMessage: noop,
  rowProps: {} as never,
};

const render = (props: Partial<MessageListProps> = {}) =>
  renderToStaticMarkup(<MessageList {...baseProps} {...props} />);

const rows = (html: string) => html.match(/data-testid="row"/g)?.length ?? 0;

describe('MessageList', () => {
  it('renders one row per message, each told which message precedes it', () => {
    const html = render({ visibleMessages: [message('m1'), message('m2'), message('m3')] });
    expect(rows(html)).toBe(3);
    expect(html).toContain('data-id="m1" data-prev="none"');
    expect(html).toContain('data-id="m2" data-prev="m1"');
    expect(html).toContain('data-id="m3" data-prev="m2"');
  });

  it('marks exactly the first unread row', () => {
    const html = render({
      visibleMessages: [message('m1'), message('m2')],
      firstUnreadId: 'm2',
    });
    expect(html.match(/data-first-unread="true"/g) ?? []).toHaveLength(1);
  });

  it('applies the per-message marks so a row never sees the whole map', () => {
    const html = render({
      visibleMessages: [message('m1'), message('m2')],
      starredIds: new Set(['m2']),
    });
    expect(html).toContain('data-id="m2" data-prev="m1" data-first-unread="false" data-starred="true"');
  });

  it('shows the older-messages spinner only while paging', () => {
    expect(render()).not.toContain('Loading older messages');
    expect(render({ isLoadingMore: true })).toContain('Loading older messages');
  });

  it('says it is still loading rather than empty while messages are awaited', () => {
    const html = render({ awaitingMessages: true });
    expect(html).toContain('Loading messages…');
    expect(html).not.toContain('No messages yet');
  });

  it('picks the empty state in its order of precedence', () => {
    expect(render()).toContain('No messages yet');
    expect(render()).toContain('Be the first to write in Pharmacology 301.');
    expect(render({ isGroup: false, name: 'Ada' })).toContain('Say hi to Ada.');
    expect(render({ starredOnly: true })).toContain('No starred messages yet');
    expect(render({ threadSearch: 'krebs' })).toContain('No matches');
    // Archived wins over both of the above.
    expect(render({ isArchived: true, starredOnly: true, threadSearch: 'krebs' })).toContain(
      'This group is archived'
    );
    // And starred wins over a search.
    expect(render({ starredOnly: true, threadSearch: 'krebs' })).toContain(
      'No starred messages yet'
    );
  });

  it('ignores a search of fewer than two characters', () => {
    expect(render({ threadSearch: 'k' })).toContain('No messages yet');
  });

  it('floats the new-messages pill only when there are messages below', () => {
    expect(render()).not.toContain('new message');
    const html = render({ newMessagesBelow: 3 });
    expect(html).toContain('3 new messages');
    expect(render({ newMessagesBelow: 1 })).toContain('1 new message');
  });
});
