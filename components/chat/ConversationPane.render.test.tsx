/**
 * Render smoke test for the conversation pane (lane M8b, step 6).
 *
 * The composer slot is four mutually exclusive states in a fixed precedence —
 * archived group, blocked DM, declined request, the real composer — and the
 * precedence IS the behaviour. Swapping two of those ternaries would put a
 * working composer inside an archived group, or offer an Unblock button to the
 * person who was blocked. None of that is visible in a diff, so it is pinned
 * here.
 *
 * The three banners above the list are also exclusive of nothing: search,
 * starred-only and pinned can all be open at once, and each has to survive the
 * others.
 *
 * `MessageInputBar` is stubbed and the list is passed in as an opaque node:
 * this file is asking what wraps the conversation, not what it contains.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ConversationPane, type ConversationPaneProps } from './ConversationPane';

vi.mock('../MessageInputBar', () => ({
  default: () => <div data-testid="composer" />,
}));

const noop = () => {};

const baseProps: ConversationPaneProps = {
  chat: { id: 'g1', chatType: 'group', name: 'Pharmacology 301' } as never,
  isGroup: true,
  isArchived: false,
  communityHost: false,
  group: { id: 'g1', name: 'Pharmacology 301', members: [] } as never,
  messageList: <div data-testid="list" />,
  visibleMessagesCount: 3,
  threadSearchOpen: false,
  threadSearch: '',
  setThreadSearch: noop,
  setThreadSearchOpen: noop,
  starredOnly: false,
  setStarredOnly: noop,
  pinnedMessage: undefined,
  scrollToMessageId: noop,
  onToggleArchiveGroup: noop,
  dmBlocked: false,
  iBlockedThem: false,
  dmBlockBusy: false,
  handleToggleDmBlock: noop,
  isDmRequestRecipient: false,
  isDmRequestSender: false,
  isDmRequestDeclinedForRecipient: false,
  dmRequestBusy: false,
  handleAcceptDmRequest: noop,
  handleDeclineDmRequest: noop,
  typingLabels: [],
  handleComposerSend: noop,
  onOpenQuestionModal: noop,
  broadcastTyping: noop,
  mentionCandidates: [],
  seedMentionUsername: null,
  setSeedMentionUsername: noop,
  replyTo: null,
  setReplyTo: noop,
  editingMessage: null,
  setEditingMessage: noop,
};

const render = (props: Partial<ConversationPaneProps> = {}) =>
  renderToStaticMarkup(<ConversationPane {...baseProps} {...props} />);

describe('ConversationPane', () => {
  it('renders the list it was given, and a composer', () => {
    const html = render();
    expect(html).toContain('data-testid="list"');
    expect(html).toContain('data-testid="composer"');
  });

  describe('the banners above the list', () => {
    it('shows none of them by default', () => {
      const html = render();
      expect(html).not.toContain('aria-label="Search this chat"');
      expect(html).not.toContain('Starred messages');
      expect(html).not.toContain('Pinned message');
    });

    it('opens an in-chat search box', () => {
      const html = render({ threadSearchOpen: true, threadSearch: 'enzyme' });
      expect(html).toContain('aria-label="Search this chat"');
      expect(html).toContain('value="enzyme"');
    });

    it('reports how many messages the starred-only view is showing', () => {
      const html = render({ starredOnly: true, visibleMessagesCount: 3 });
      expect(html).toContain('Starred messages (3)');
      expect(html).toContain('Show all');
    });

    it('shows a pinned message, preferring its question stem over its text', () => {
      const html = render({
        pinnedMessage: { id: 'm9', text: 'body', questionStem: 'Which enzyme?' } as never,
      });
      expect(html).toContain('Which enzyme?');
      expect(html).not.toContain('>body<');
    });

    it('lets all three be open at once', () => {
      const html = render({
        threadSearchOpen: true,
        starredOnly: true,
        pinnedMessage: { id: 'm9', text: 'Pinned thing' } as never,
      });
      expect(html).toContain('aria-label="Search this chat"');
      expect(html).toContain('Starred messages');
      expect(html).toContain('Pinned thing');
    });
  });

  describe('the composer slot, in precedence order', () => {
    it('an archived group offers Unarchive instead of a composer', () => {
      const html = render({ isArchived: true });
      expect(html).not.toContain('data-testid="composer"');
      expect(html).toContain('This group is archived.');
      expect(html).toContain('Unarchive');
    });

    it('archived wins over everything else, search included', () => {
      const html = render({ isArchived: true, threadSearchOpen: true, dmBlocked: true });
      expect(html).toContain('This group is archived.');
      expect(html).not.toContain('data-testid="composer"');
      // The banner is above the slot, so it still renders.
      expect(html).toContain('aria-label="Search this chat"');
    });

    it('a blocked DM offers Unblock only to the side that blocked', () => {
      const mine = render({ dmBlocked: true, iBlockedThem: true });
      expect(mine).toContain('You blocked this user.');
      expect(mine).toContain('Unblock');

      const theirs = render({ dmBlocked: true, iBlockedThem: false });
      expect(theirs).toContain('You can’t message this user.');
      expect(theirs).not.toContain('Unblock');
    });

    it('a declined request stays one-way, with no composer', () => {
      const html = render({ isDmRequestDeclinedForRecipient: true });
      expect(html).not.toContain('data-testid="composer"');
      expect(html).toContain('You declined this message request.');
    });

    it('an inbound request gets Accept and Decline ABOVE a working composer', () => {
      const html = render({ isDmRequestRecipient: true });
      expect(html).toContain('data-testid="composer"');
      expect(html).toContain('Accept');
      expect(html).toContain('Decline');
      expect(html.indexOf('Accept')).toBeLessThan(html.indexOf('data-testid="composer"'));
    });

    it('a request you sent says so, and still lets you write', () => {
      const html = render({ isDmRequestSender: true });
      expect(html).toContain('data-testid="composer"');
      expect(html).toContain('Message request sent');
      expect(html).not.toContain('>Accept<');
    });
  });

  describe('the typing line', () => {
    it('names one peer', () => {
      expect(render({ typingLabels: ['Chidi'] })).toContain('Chidi is typing…');
    });

    it('names two, and stops naming at two', () => {
      const html = render({ typingLabels: ['Chidi', 'Ada', 'Bola'] });
      expect(html).toContain('Chidi and Ada are typing…');
      expect(html).not.toContain('Bola');
    });
  });
});
