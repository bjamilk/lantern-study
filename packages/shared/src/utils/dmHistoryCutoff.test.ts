import { describe, expect, it } from '@jest/globals';
import {
  clearDmHistoryClearedAtForUser,
  effectiveDmUnreadFloor,
  filterMessagesAfterDmHistoryCutoff,
  readDmHistoryClearedAt,
  withDmHistoryClearedAt,
} from './dmHistoryCutoff';

describe('dmHistoryCutoff', () => {
  it('reads and writes per-user cutoffs', () => {
    expect(readDmHistoryClearedAt(null, 'u1')).toBeNull();
    expect(readDmHistoryClearedAt({ u1: 'not-a-date' }, 'u1')).toBeNull();
    const iso = '2026-07-30T18:00:00.000Z';
    expect(readDmHistoryClearedAt({ u1: iso }, 'u1')).toBe(iso);
    expect(withDmHistoryClearedAt({ u2: iso }, 'u1', '2026-07-30T19:00:00.000Z')).toEqual({
      u2: iso,
      u1: '2026-07-30T19:00:00.000Z',
    });
  });

  it('filters messages at or before cutoff for the deleter', () => {
    const cutoff = '2026-07-30T18:00:00.000Z';
    const messages = [
      { id: 'a', timestamp: '2026-07-30T17:59:59.000Z' },
      { id: 'b', timestamp: '2026-07-30T18:00:00.000Z' },
      { id: 'c', timestamp: '2026-07-30T18:00:01.000Z' },
      { id: 'no-ts', timestamp: null },
    ];
    expect(filterMessagesAfterDmHistoryCutoff(messages, cutoff).map((m) => m.id)).toEqual([
      'c',
      'no-ts',
    ]);
  });

  it('keeps in-flight optimistic temps even at or before cutoff', () => {
    const cutoff = '2026-07-30T18:00:00.000Z';
    const messages = [
      { id: 'temp-first-send', timestamp: cutoff },
      { id: 'old', timestamp: '2026-07-30T17:00:00.000Z' },
    ];
    expect(filterMessagesAfterDmHistoryCutoff(messages, cutoff).map((m) => m.id)).toEqual([
      'temp-first-send',
    ]);
  });

  it('clears one user cutoff when they send again', () => {
    expect(
      clearDmHistoryClearedAtForUser(
        { u1: '2026-07-30T18:00:00.000Z', u2: '2026-07-30T17:00:00.000Z' },
        'u1',
      ),
    ).toEqual({ u2: '2026-07-30T17:00:00.000Z' });
  });

  it('uses the later of last-read and history cutoff for unread floor', () => {
    expect(effectiveDmUnreadFloor(null, null)).toBe('1970-01-01T00:00:00.000Z');
    expect(effectiveDmUnreadFloor('2026-07-30T10:00:00.000Z', '2026-07-30T12:00:00.000Z')).toBe(
      '2026-07-30T12:00:00.000Z',
    );
    expect(effectiveDmUnreadFloor('2026-07-30T14:00:00.000Z', '2026-07-30T12:00:00.000Z')).toBe(
      '2026-07-30T14:00:00.000Z',
    );
  });
});
