/**
 * Render smoke test for one conversation row (lane M8, step 2).
 *
 * A row makes three decisions and renders one child, so those three decisions
 * are what is tested: does a date separator go above it, does the unread
 * divider, and is it grouped with the message before it. `MessageItem` is
 * stubbed — it is 700 lines of its own and already has its own tests; what
 * matters here is which props the row hands it.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MessageRow, type MessageRowProps } from './MessageRow';

/** Renders every prop the row passes as a data attribute, so it can be asserted. */
vi.mock('../MessageItem', () => ({
  default: (props: Record<string, unknown>) => (
    <div
      data-testid="message-item"
      data-message-id={String((props.message as { id: string }).id)}
      data-grouped={String(props.isGroupedWithPrevious)}
      data-starred={String(props.starred)}
      data-pinned={String(props.pinned)}
      data-own={String(props.isCurrentUserMessage)}
      data-can-vote={String(props.onVoteQuestion !== undefined)}
      data-can-report={String(props.onReportMessage !== undefined)}
    />
  ),
}));

const noop = () => {};
const at = (iso: string) => iso;

const message = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    id: 'm2',
    text: 'Second',
    timestamp: at('2026-09-15T10:05:00.000Z'),
    sender: { id: 'u1', name: 'Ada' },
    ...over,
  }) as never;

const baseProps: MessageRowProps = {
  message: message(),
  previousMessage: null,
  isFirstUnread: false,
  firstUnreadRef: { current: null },
  registerNode: noop,
  onScrollToMessage: noop,
  currentUser: { id: 'u1', name: 'Ada' } as never,
  chatId: 'g1',
  isGroup: true,
  group: { id: 'g1', members: [] } as never,
  communityHost: false,
  currentUserVote: undefined,
  myReactions: undefined,
  starred: false,
  pinned: false,
  handleToggleReaction: noop,
  onVoteQuestion: noop,
  onFlagAsSimilar: noop,
  handleOpenThread: noop,
  beginEditingMessage: noop,
  handleRemoveMessage: noop,
  handleCopyMessage: noop,
  handleToggleStar: noop,
  handleTogglePin: noop,
  setReportTarget: noop,
  setEditingMessage: noop,
  setReplyTo: noop,
  setForwardMessage: noop,
  setSeedMentionUsername: noop,
};

const render = (props: Partial<MessageRowProps> = {}) =>
  renderToStaticMarkup(<MessageRow {...baseProps} {...props} />);

describe('MessageRow', () => {
  it('renders the message', () => {
    const html = render();
    expect(html).toContain('data-message-id="m2"');
  });

  it('puts a date separator above the first row of a day', () => {
    // No previous message at all: the list starts with a separator.
    expect(render()).toContain('flex-1 h-px bg-lantern-background-secondary');
    // Same day as the previous message: no separator.
    const sameDay = render({
      previousMessage: message({ id: 'm1', timestamp: at('2026-09-15T09:00:00.000Z') }),
    });
    expect(sameDay).not.toContain('flex-1 h-px bg-lantern-background-secondary');
    // A day earlier: separator again.
    const nextDay = render({
      previousMessage: message({ id: 'm1', timestamp: at('2026-09-14T23:50:00.000Z') }),
    });
    expect(nextDay).toContain('flex-1 h-px bg-lantern-background-secondary');
  });

  it('groups a same-sender message sent within five minutes, and not one after', () => {
    const grouped = render({
      previousMessage: message({ id: 'm1', timestamp: at('2026-09-15T10:02:00.000Z') }),
    });
    expect(grouped).toContain('data-grouped="true"');

    const tooLate = render({
      previousMessage: message({ id: 'm1', timestamp: at('2026-09-15T09:55:00.000Z') }),
    });
    expect(tooLate).toContain('data-grouped="false"');

    const otherSender = render({
      previousMessage: message({
        id: 'm1',
        timestamp: at('2026-09-15T10:02:00.000Z'),
        sender: { id: 'u2', name: 'Bello' },
      }),
    });
    expect(otherSender).toContain('data-grouped="false"');
  });

  it('never groups the row that carries the unread divider', () => {
    const html = render({
      previousMessage: message({ id: 'm1', timestamp: at('2026-09-15T10:02:00.000Z') }),
      isFirstUnread: true,
    });
    expect(html).toContain('data-testid="unread-divider"');
    expect(html).toContain('New messages');
    expect(html).toContain('data-grouped="false"');
  });

  it('shows no unread divider on any other row', () => {
    expect(render()).not.toContain('data-testid="unread-divider"');
  });

  it('passes the viewer’s own marks through to the message', () => {
    const html = render({ starred: true, pinned: true });
    expect(html).toContain('data-starred="true"');
    expect(html).toContain('data-pinned="true"');
    expect(html).toContain('data-own="true"');
  });

  it('withholds voting and similar-flagging on a community board', () => {
    expect(render()).toContain('data-can-vote="true"');
    expect(render({ communityHost: true })).toContain('data-can-vote="false"');
  });

  it('offers reporting in a group and not in a DM', () => {
    expect(render()).toContain('data-can-report="true"');
    expect(render({ isGroup: false })).toContain('data-can-report="false"');
  });
});
