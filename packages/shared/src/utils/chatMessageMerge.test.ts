import { describe, expect, it } from '@jest/globals';
import { mergeChatMessagesById } from './chatMessageMerge';

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
    expect(merged[0].id).toBe('server-1');
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
});
