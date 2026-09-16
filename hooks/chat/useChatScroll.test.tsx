// @vitest-environment jsdom
/**
 * Contract test for the conversation's scroll position (lane M8b, step 4).
 *
 * Three rules decide everything this hook does, and all three are the kind that
 * look like details and read as bugs:
 *
 *  1. The unread divider goes at the first message the reader has NOT read and
 *     did not send. `unreadAnchorAt === undefined` means mark-as-read has not
 *     reported yet and must WAIT; `null` means fully read. Conflating those two
 *     is how the divider ends up at the top of a conversation you have read.
 *  2. A new message scrolls the list only when the reader is near the bottom or
 *     the message is theirs. Otherwise it bumps the "N new messages" pill —
 *     yanking someone away from what they are reading is the failure here.
 *  3. Paging older history restores the scroll position by height delta, and
 *     latches `hasMore` false on an empty page or a chat type with no pager, so
 *     the top of the list stops implying history that does not exist.
 *
 * The hook is mounted for real (jsdom + react-dom/client) because its effects
 * ARE the behaviour. `scrollIntoView` does not exist in jsdom, so it is stubbed
 * on the prototype and recorded; the refs are attached to real elements whose
 * scroll geometry is defined by hand, since jsdom lays nothing out.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatScroll } from './useChatScroll';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const scrolledInto: Array<Record<string, unknown> | undefined> = [];

const chat = { id: 'g1', chatType: 'group' } as never;

const message = (id: string, senderId = 'u2', timestamp = '2026-09-15T10:00:00.000Z') =>
  ({ id, text: id, timestamp, sender: { id: senderId } }) as never;

let container: HTMLDivElement;
let root: Root;
let api: ReturnType<typeof useChatScroll>;

type Params = Record<string, unknown>;

const Probe: React.FC<{ params: Params }> = ({ params }) => {
  api = useChatScroll({
    chat,
    currentUserId: 'u1',
    messagesLength: 0,
    visibleMessages: [],
    ...params,
  } as never);
  // The end sentinel has to be a real node for `scrollToBottom` to reach it.
  return <div ref={api.messagesEndRef} />;
};

const mount = async (params: Params = {}) => {
  await act(async () => {
    root.render(<Probe params={params} />);
  });
};

/** A scroll event on a container with the geometry a test needs. */
const scrollEvent = (geometry: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}) => ({ currentTarget: { ...geometry } }) as never;

beforeEach(() => {
  vi.useFakeTimers();
  scrolledInto.length = 0;
  Element.prototype.scrollIntoView = function scrollIntoViewStub(options?: unknown) {
    scrolledInto.push(options as Record<string, unknown>);
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('useChatScroll', () => {
  it('hands back exactly the nine things the conversation needs', async () => {
    await mount();
    expect(Object.keys(api).sort()).toEqual([
      'awaitingMessages',
      'firstUnreadId',
      'firstUnreadRef',
      'handleScroll',
      'isLoadingMore',
      'messagesContainerRef',
      'messagesEndRef',
      'newMessagesBelow',
      'scrollToBottom',
    ]);
  });

  describe('the loading state', () => {
    it('waits while a conversation has no messages yet', async () => {
      await mount();
      expect(api.awaitingMessages).toBe(true);
    });

    it('stops waiting as soon as the first messages arrive', async () => {
      await mount();
      await mount({ messagesLength: 3 });
      expect(api.awaitingMessages).toBe(false);
    });

    it('gives up after ten seconds, so an empty chat settles instead of spinning', async () => {
      await mount();
      expect(api.awaitingMessages).toBe(true);
      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });
      expect(api.awaitingMessages).toBe(false);
    });
  });

  describe('the unread divider', () => {
    it('waits for mark-as-read to report, rather than guessing', async () => {
      await mount({
        visibleMessages: [message('m1')],
        unreadAnchorAt: undefined,
      });
      expect(api.firstUnreadId).toBeNull();
    });

    it('marks nothing unread when the conversation is fully read', async () => {
      await mount({ visibleMessages: [message('m1')], unreadAnchorAt: null });
      expect(api.firstUnreadId).toBeNull();
    });

    it('marks the first message after the watermark', async () => {
      await mount({
        visibleMessages: [
          message('old', 'u2', '2026-09-15T09:00:00.000Z'),
          message('new', 'u2', '2026-09-15T11:00:00.000Z'),
          message('newer', 'u2', '2026-09-15T12:00:00.000Z'),
        ],
        unreadAnchorAt: '2026-09-15T10:00:00.000Z',
      });
      expect(api.firstUnreadId).toBe('new');
    });

    it('never marks the viewer’s own message as unread', async () => {
      await mount({
        visibleMessages: [
          message('mine', 'u1', '2026-09-15T11:00:00.000Z'),
          message('theirs', 'u2', '2026-09-15T12:00:00.000Z'),
        ],
        unreadAnchorAt: '2026-09-15T10:00:00.000Z',
      });
      expect(api.firstUnreadId).toBe('theirs');
    });
  });

  describe('a new message arriving', () => {
    /** Open the conversation and let the once-per-chat anchor settle. */
    const open = async (visibleMessages: unknown[]) => {
      await mount({ visibleMessages, unreadAnchorAt: null });
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      scrolledInto.length = 0;
    };

    it('scrolls when the reader is at the bottom', async () => {
      await open([message('m1')]);
      await mount({ visibleMessages: [message('m1'), message('m2')], unreadAnchorAt: null });
      expect(scrolledInto.length).toBeGreaterThan(0);
      expect(api.newMessagesBelow).toBe(0);
    });

    it('bumps the pill instead when the reader has scrolled up', async () => {
      await open([message('m1')]);
      // Reading history: 400px from the bottom is not "near bottom".
      act(() => {
        void api.handleScroll(
          scrollEvent({ scrollTop: 100, scrollHeight: 1000, clientHeight: 500 })
        );
      });
      await mount({ visibleMessages: [message('m1'), message('m2')], unreadAnchorAt: null });
      expect(scrolledInto).toEqual([]);
      expect(api.newMessagesBelow).toBe(1);
    });

    it('scrolls to the reader’s OWN message even when they are scrolled up', async () => {
      await open([message('m1')]);
      act(() => {
        void api.handleScroll(
          scrollEvent({ scrollTop: 100, scrollHeight: 1000, clientHeight: 500 })
        );
      });
      await mount({
        visibleMessages: [message('m1'), message('m2', 'u1')],
        unreadAnchorAt: null,
      });
      expect(scrolledInto.length).toBeGreaterThan(0);
      expect(api.newMessagesBelow).toBe(0);
    });

    it('does not bump the pill for an edit or a reaction on the same tail', async () => {
      await open([message('m1'), message('m2')]);
      act(() => {
        void api.handleScroll(
          scrollEvent({ scrollTop: 100, scrollHeight: 1000, clientHeight: 500 })
        );
      });
      // Same ids, new objects — what an edit or a reaction produces.
      await mount({
        visibleMessages: [message('m1'), message('m2')],
        unreadAnchorAt: null,
      });
      expect(api.newMessagesBelow).toBe(0);
    });

    it('clears the pill when the reader scrolls back down', async () => {
      await open([message('m1')]);
      act(() => {
        void api.handleScroll(
          scrollEvent({ scrollTop: 100, scrollHeight: 1000, clientHeight: 500 })
        );
      });
      await mount({ visibleMessages: [message('m1'), message('m2')], unreadAnchorAt: null });
      expect(api.newMessagesBelow).toBe(1);
      await act(async () => {
        void api.handleScroll(
          scrollEvent({ scrollTop: 500, scrollHeight: 1000, clientHeight: 500 })
        );
      });
      expect(api.newMessagesBelow).toBe(0);
    });
  });

  describe('paging older history', () => {
    const atTop = scrollEvent({ scrollTop: 0, scrollHeight: 1000, clientHeight: 500 });

    it('asks the group pager for a group chat', async () => {
      const onLoadMoreMessages = vi.fn().mockResolvedValue(20);
      await mount({ onLoadMoreMessages });
      await act(async () => {
        await api.handleScroll(atTop);
      });
      expect(onLoadMoreMessages).toHaveBeenCalledWith('g1');
    });

    it('stops asking once a page comes back empty', async () => {
      const onLoadMoreMessages = vi.fn().mockResolvedValue(0);
      await mount({ onLoadMoreMessages });
      await act(async () => {
        await api.handleScroll(atTop);
      });
      await act(async () => {
        await api.handleScroll(atTop);
      });
      expect(onLoadMoreMessages).toHaveBeenCalledTimes(1);
    });

    it('stops implying history exists when the chat type has no pager', async () => {
      const onLoadMoreDirectMessages = vi.fn();
      // A group chat with only the DM pager supplied: no pager applies.
      await mount({ onLoadMoreDirectMessages });
      await act(async () => {
        await api.handleScroll(atTop);
      });
      expect(onLoadMoreDirectMessages).not.toHaveBeenCalled();
      // `hasMore` latched false, so a second scroll to the top asks nothing.
      expect(api.isLoadingMore).toBe(false);
    });
  });
});
