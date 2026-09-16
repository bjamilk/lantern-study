// @vitest-environment jsdom
/**
 * Contract test for the two broadcast channels a conversation opens (lane M8b,
 * step 4).
 *
 * The behaviour worth pinning is the TEARDOWN, because its failure mode is
 * silent and cross-conversation: a typing timer that outlives its channel makes
 * "X is typing…" follow the reader into the next chat, where X is not even a
 * member. So the tests assert the full lifecycle — one channel per chat id, a
 * new one on change, the old one removed, the id list emptied — as well as the
 * three things the typing handler refuses to do (echo the viewer, duplicate an
 * id, hold one past three seconds).
 *
 * The hook is mounted for real (jsdom + react-dom/client); only
 * `services/supabase` is replaced, by a channel double that records what was
 * subscribed and hands back the registered handlers so a broadcast can be
 * delivered on demand.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatRealtime } from './useChatRealtime';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Handler = (message: { payload: Record<string, unknown> }) => void;

interface FakeChannel {
  name: string;
  handlers: Record<string, Handler>;
  subscribed: boolean;
  sent: unknown[];
}

const channels: FakeChannel[] = [];
const removed: string[] = [];

vi.mock('../../services/supabase', () => ({
  supabase: {
    channel: (name: string) => {
      const channel: FakeChannel = { name, handlers: {}, subscribed: false, sent: [] };
      channels.push(channel);
      const api = {
        name,
        on: (_type: string, opts: { event: string }, handler: Handler) => {
          channel.handlers[opts.event] = handler;
          return api;
        },
        subscribe: () => {
          channel.subscribed = true;
          return api;
        },
        send: (payload: unknown) => {
          channel.sent.push(payload);
          return Promise.resolve();
        },
      };
      return api;
    },
    removeChannel: (api: unknown) => {
      // The double hands its `api` object back, carrying the channel's name.
      removed.push((api as { name?: string }).name ?? 'unknown');
      return Promise.resolve();
    },
  },
}));

let container: HTMLDivElement;
let root: Root;
let api: ReturnType<typeof useChatRealtime>;

const Probe: React.FC<{ params: Record<string, unknown> }> = ({ params }) => {
  api = useChatRealtime({
    chatId: 'g1',
    currentUserId: 'u1',
    lowDataMode: false,
    ...params,
  } as never);
  return null;
};

const mount = async (params: Record<string, unknown> = {}) => {
  await act(async () => {
    root.render(<Probe params={params} />);
  });
};

const channelNamed = (name: string) => channels.find((c) => c.name === name);
const typingOn = (chatId: string) => channelNamed(`typing:${chatId}`);

beforeEach(() => {
  vi.useFakeTimers();
  channels.length = 0;
  removed.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('useChatRealtime', () => {
  it('returns the typing ids and one way to announce typing', async () => {
    await mount();
    expect(Object.keys(api).sort()).toEqual(['broadcastTyping', 'typingUserIds']);
    expect(api.typingUserIds).toEqual([]);
  });

  it('opens one channel per conversation, both subscribed', async () => {
    await mount();
    expect(typingOn('g1')?.subscribed).toBe(true);
    expect(channelNamed('chat-read:g1')?.subscribed).toBe(true);
  });

  it('opens no channel at all when no conversation is selected', async () => {
    await mount({ chatId: undefined });
    expect(channels).toHaveLength(0);
  });

  it('skips the read channel entirely in low-data mode', async () => {
    await mount({ lowDataMode: true });
    expect(typingOn('g1')).toBeTruthy();
    expect(channelNamed('chat-read:g1')).toBeUndefined();
  });

  it('shows a peer who is typing, and drops them after three seconds', async () => {
    await mount();
    await act(async () => {
      typingOn('g1')?.handlers.typing?.({ payload: { userId: 'u2' } });
    });
    expect(api.typingUserIds).toEqual(['u2']);

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(api.typingUserIds).toEqual([]);
  });

  it('ignores the viewer’s own typing broadcast', async () => {
    await mount();
    await act(async () => {
      typingOn('g1')?.handlers.typing?.({ payload: { userId: 'u1' } });
    });
    expect(api.typingUserIds).toEqual([]);
  });

  it('holds a peer once, however many broadcasts arrive', async () => {
    await mount();
    await act(async () => {
      typingOn('g1')?.handlers.typing?.({ payload: { userId: 'u2' } });
      typingOn('g1')?.handlers.typing?.({ payload: { userId: 'u2' } });
    });
    expect(api.typingUserIds).toEqual(['u2']);
  });

  it('hands a peer read watermark straight back, and never its own', async () => {
    const onPeerChatRead = vi.fn();
    await mount({ onPeerChatRead });
    const read = channelNamed('chat-read:g1');
    await act(async () => {
      read?.handlers.read?.({ payload: { userId: 'u2', lastReadAt: '2026-09-15T10:00:00Z' } });
      read?.handlers.read?.({ payload: { userId: 'u1', lastReadAt: '2026-09-15T11:00:00Z' } });
      // A watermark with no timestamp is not a watermark.
      read?.handlers.read?.({ payload: { userId: 'u3' } });
    });
    expect(onPeerChatRead).toHaveBeenCalledTimes(1);
    expect(onPeerChatRead).toHaveBeenCalledWith({
      userId: 'u2',
      lastReadAt: '2026-09-15T10:00:00Z',
    });
  });

  it('broadcasts the viewer typing on the open channel', async () => {
    await mount();
    act(() => {
      api.broadcastTyping();
    });
    expect(typingOn('g1')?.sent).toEqual([
      { type: 'broadcast', event: 'typing', payload: { userId: 'u1' } },
    ]);
  });

  it('does not carry a stale typing peer into the next conversation', async () => {
    await mount();
    await act(async () => {
      typingOn('g1')?.handlers.typing?.({ payload: { userId: 'u2' } });
    });
    expect(api.typingUserIds).toEqual(['u2']);

    await mount({ chatId: 'g2' });
    // The list is emptied on teardown, both old channels are removed, and the
    // new conversation gets its own pair.
    expect(api.typingUserIds).toEqual([]);
    expect(removed).toContain('typing:g1');
    expect(removed).toContain('chat-read:g1');
    expect(typingOn('g2')?.subscribed).toBe(true);
  });
});
