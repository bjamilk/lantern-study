import { describe, expect, it } from '@jest/globals';
import { isOptimisticDmThread, mergeDmThreadLists, withTransientRetry } from './dmThreads';

describe('mergeDmThreadLists', () => {
  it('merges by id and prefers server unread counts', () => {
    const existing = [
      {
        id: 't1',
        lastMessage: 'old',
        lastMessageTimestamp: '2026-07-30T12:00:00.000Z',
        unreadCount: 3,
        participants: { a: { name: 'A' } },
      },
    ];
    const fetched = [
      {
        id: 't1',
        lastMessage: 'new',
        lastMessageTimestamp: '2026-07-30T12:05:00.000Z',
        unreadCount: 0,
        participants: { b: { name: 'B' } },
      },
    ];
    const merged = mergeDmThreadLists(existing, fetched, 'server');
    expect(merged).toHaveLength(1);
    expect(merged[0]?.lastMessage).toBe('new');
    expect(merged[0]?.unreadCount).toBe(0);
    expect(merged[0]?.participants).toEqual({ a: { name: 'A' }, b: { name: 'B' } });
  });

  it('keeps optimistic locals in soft and server modes', () => {
    const existing = [{ id: 'local-opt', participants: {} }];
    const fetched = [
      {
        id: 't1',
        lastMessage: 'hi',
        lastMessageTimestamp: '2026-07-30T12:00:00.000Z',
      },
    ];
    expect(mergeDmThreadLists(existing, fetched, 'soft').map((t) => t.id).sort()).toEqual([
      'local-opt',
      't1',
    ]);
    expect(mergeDmThreadLists(existing, fetched, 'server').map((t) => t.id).sort()).toEqual([
      'local-opt',
      't1',
    ]);
  });

  it('drops stale non-optimistic locals on server merge', () => {
    const existing = [
      {
        id: 'hidden',
        lastMessage: 'gone',
        lastMessageTimestamp: '2026-07-30T11:00:00.000Z',
      },
    ];
    const fetched = [
      {
        id: 't1',
        lastMessage: 'hi',
        lastMessageTimestamp: '2026-07-30T12:00:00.000Z',
      },
    ];
    expect(mergeDmThreadLists(existing, fetched, 'server').map((t) => t.id)).toEqual(['t1']);
  });

  it('detects optimistic threads', () => {
    expect(isOptimisticDmThread({ id: 'x' })).toBe(true);
    expect(
      isOptimisticDmThread({
        id: 'x',
        lastMessage: 'hi',
        lastMessageTimestamp: '2026-07-30T12:00:00.000Z',
      })
    ).toBe(false);
  });

  it('keeps clientPending first-DM threads after local lastMessage write', () => {
    const existing = [
      {
        id: 'a-b',
        lastMessage: 'hello',
        lastMessageTimestamp: '2026-07-30T12:00:00.000Z',
        clientPending: true,
      },
    ];
    const fetched: Array<{ id: string; lastMessage?: string }> = [];
    expect(mergeDmThreadLists(existing, fetched, 'server').map((t) => t.id)).toEqual(['a-b']);
    expect(isOptimisticDmThread(existing[0]!)).toBe(true);
  });

  it('clears clientPending when server returns the thread', () => {
    const existing = [
      {
        id: 'a-b',
        lastMessage: 'hello',
        lastMessageTimestamp: '2026-07-30T12:00:00.000Z',
        clientPending: true,
        participants: { a: { name: 'A' } },
      },
    ];
    const fetched = [
      {
        id: 'a-b',
        lastMessage: 'hello',
        lastMessageTimestamp: '2026-07-30T12:00:01.000Z',
        participants: { b: { name: 'B' } },
      },
    ];
    const merged = mergeDmThreadLists(existing, fetched, 'server');
    expect(merged).toHaveLength(1);
    expect(merged[0]?.clientPending).toBeUndefined();
    expect(merged[0]?.participants).toEqual({ a: { name: 'A' }, b: { name: 'B' } });
  });
});

describe('withTransientRetry', () => {
  it('retries once then succeeds', async () => {
    let attempts = 0;
    const result = await withTransientRetry(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('Failed to fetch');
      return 'ok';
    }, { delayMs: 1 });
    expect(result).toBe('ok');
    expect(attempts).toBe(2);
  });

  it('does not retry non-transient errors', async () => {
    let attempts = 0;
    await expect(
      withTransientRetry(async () => {
        attempts += 1;
        throw new Error('permission denied');
      }, { delayMs: 1 })
    ).rejects.toThrow('permission denied');
    expect(attempts).toBe(1);
  });
});
