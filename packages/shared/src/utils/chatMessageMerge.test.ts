import { describe, expect, it } from '@jest/globals';
import { mergeChatMessagesById, mergeServerRefresh } from './chatMessageMerge';

describe('mergeChatMessagesById', () => {
  it('keeps realtime-only messages when a stale fetch omits them', () => {
    const existing = [
      { id: 'a', timestamp: '2026-07-30T12:00:00.000Z', text: 'hi' },
      { id: 'b', timestamp: '2026-07-30T12:01:00.000Z', text: 'live' },
    ];
    const incoming = [
      { id: 'a', timestamp: '2026-07-30T12:00:00.000Z', text: 'hi' },
    ];
    const merged = mergeChatMessagesById(existing, incoming);
    expect(merged.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('reconciles optimistic temp ids via clientMessageId', () => {
    const existing = [
      { id: 'msg-temp-1', timestamp: '2026-07-30T12:00:00.000Z', text: 'sending' },
    ];
    const incoming = [
      {
        id: 'server-1',
        clientMessageId: 'msg-temp-1',
        timestamp: '2026-07-30T12:00:01.000Z',
        text: 'sending',
      },
    ];
    const merged = mergeChatMessagesById(existing, incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe('server-1');
  });

  it('keeps unmatched optimistic messages', () => {
    const existing = [
      { id: 'msg-temp-2', timestamp: '2026-07-30T12:02:00.000Z', text: 'pending' },
      { id: 'a', timestamp: '2026-07-30T12:00:00.000Z', text: 'hi' },
    ];
    const incoming = [
      { id: 'a', timestamp: '2026-07-30T12:00:00.000Z', text: 'hi' },
    ];
    const merged = mergeChatMessagesById(existing, incoming);
    expect(merged.map((m) => m.id).sort()).toEqual(['a', 'msg-temp-2']);
  });

  it('keeps first-DM optimistic temp when a concurrent empty fetch arrives', () => {
    const existing = [
      {
        id: 'temp-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        timestamp: '2026-07-30T12:00:00.000Z',
        text: 'hello first timer',
      },
    ];
    const merged = mergeChatMessagesById(existing, []);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe('temp-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  it('reconciles temp-prefixed first send via clientMessageId from fetch', () => {
    const existing = [
      {
        id: 'temp-client-1',
        clientMessageId: 'temp-client-1',
        timestamp: '2026-07-30T12:00:00.000Z',
        text: 'hi',
      },
    ];
    const incoming = [
      {
        id: 'server-dm-1',
        clientMessageId: 'temp-client-1',
        timestamp: '2026-07-30T12:00:01.000Z',
        text: 'hi',
      },
    ];
    const merged = mergeChatMessagesById(existing, incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe('server-dm-1');
  });
});

describe('mergeServerRefresh', () => {
  const t = (minute: number) => `2026-07-30T12:${String(minute).padStart(2, '0')}:00.000Z`;

  it('lets the fresh server row win over stale cached reactions', () => {
    const server = [{ id: 'a', timestamp: t(0), text: 'hi', reactions: { '👍': 1 } }];
    const cached = [{ id: 'a', timestamp: t(0), text: 'hi', reactions: {} }];
    const merged = mergeServerRefresh(server, cached);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.reactions).toEqual({ '👍': 1 });
  });

  it('does not let a stale cached edit/removal clobber the server row', () => {
    const server = [{ id: 'a', timestamp: t(0), text: 'edited', isRemoved: false }];
    const cached = [{ id: 'a', timestamp: t(0), text: 'old', isRemoved: true }];
    const merged = mergeServerRefresh(server, cached);
    expect(merged[0]?.text).toBe('edited');
    expect(merged[0]?.isRemoved).toBe(false);
  });

  it('keeps cached-only fields the server never returns', () => {
    const server: Array<{ id: string; timestamp: string; text: string; bookmarked?: boolean }> = [
      { id: 'a', timestamp: t(0), text: 'hi' },
    ];
    const cached = [{ id: 'a', timestamp: t(0), text: 'hi', bookmarked: true }];
    const merged = mergeServerRefresh(server, cached);
    expect(merged[0]?.bookmarked).toBe(true);
  });

  it('keeps a pending local row the server page does not contain', () => {
    const server = [{ id: 'a', timestamp: t(0), text: 'hi' }];
    const cached = [
      { id: 'a', timestamp: t(0), text: 'hi' },
      { id: 'msg-1', timestamp: t(1), text: 'sending', deliveryState: 'pending' as const },
    ];
    const merged = mergeServerRefresh(server, cached);
    expect(merged.map((m) => m.id)).toEqual(['a', 'msg-1']);
  });

  it('keeps a failed local row even inside the server page window', () => {
    const server = [
      { id: 'a', timestamp: t(0), text: 'hi' },
      { id: 'c', timestamp: t(5), text: 'later' },
    ];
    const cached = [
      { id: 'a', timestamp: t(0), text: 'hi' },
      { id: 'local-9', timestamp: t(2), text: 'nope', deliveryState: 'failed' as const },
      { id: 'c', timestamp: t(5), text: 'later' },
    ];
    const merged = mergeServerRefresh(server, cached);
    expect(merged.map((m) => m.id)).toEqual(['a', 'local-9', 'c']);
  });

  it('drops a cached row inside the page window that the server deleted', () => {
    const server = [
      { id: 'a', timestamp: t(0), text: 'hi' },
      { id: 'c', timestamp: t(5), text: 'later' },
    ];
    const cached = [
      { id: 'a', timestamp: t(0), text: 'hi' },
      { id: 'b', timestamp: t(2), text: 'deleted server-side' },
      { id: 'c', timestamp: t(5), text: 'later' },
    ];
    const merged = mergeServerRefresh(server, cached);
    expect(merged.map((m) => m.id)).toEqual(['a', 'c']);
  });

  it('keeps older cached rows from earlier pages and newer realtime rows', () => {
    const server = [
      { id: 'p1', timestamp: t(10), text: 'page 1 oldest' },
      { id: 'p2', timestamp: t(11), text: 'page 1 newest' },
    ];
    const cached = [
      { id: 'older', timestamp: t(1), text: 'page 2 row' },
      { id: 'p1', timestamp: t(10), text: 'page 1 oldest' },
      { id: 'realtime', timestamp: t(20), text: 'arrived mid-fetch' },
    ];
    const merged = mergeServerRefresh(server, cached);
    expect(merged.map((m) => m.id)).toEqual(['older', 'p1', 'p2', 'realtime']);
  });

  it('reconciles a cached temp row via clientMessageId and clears its delivery state', () => {
    const server: Array<{
      id: string;
      clientMessageId?: string;
      timestamp: string;
      text: string;
      deliveryState?: 'pending' | 'failed';
    }> = [{ id: 'server-1', clientMessageId: 'temp-1', timestamp: t(1), text: 'hi' }];
    const cached = [
      {
        id: 'temp-1',
        clientMessageId: 'temp-1',
        timestamp: t(1),
        text: 'hi',
        deliveryState: 'pending' as const,
      },
    ];
    const merged = mergeServerRefresh(server, cached);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe('server-1');
    expect(merged[0]?.deliveryState).toBeUndefined();
  });

  it('drops a reconciled temp row that also exists under its server id', () => {
    const server = [
      { id: 'a', timestamp: t(0), text: 'hi' },
      { id: 'server-2', clientMessageId: 'msg-2', timestamp: t(3), text: 'sent' },
    ];
    const cached = [
      { id: 'a', timestamp: t(0), text: 'hi' },
      { id: 'msg-2', timestamp: t(3), text: 'sent' },
      { id: 'server-2', clientMessageId: 'msg-2', timestamp: t(3), text: 'sent' },
    ];
    const merged = mergeServerRefresh(server, cached);
    expect(merged.map((m) => m.id)).toEqual(['a', 'server-2']);
  });

  it('treats an empty server page as no information and keeps the cache', () => {
    const cached = [{ id: 'a', timestamp: t(0), text: 'hi' }];
    expect(mergeServerRefresh([], cached)).toEqual(cached);
  });

  it('returns the server page verbatim when there is no cache', () => {
    const server = [{ id: 'a', timestamp: t(0), text: 'hi' }];
    expect(mergeServerRefresh(server, [])).toEqual(server);
  });
});
