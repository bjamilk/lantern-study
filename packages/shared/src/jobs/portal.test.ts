import { describe, expect, it } from 'vitest';
import { formatJobLocation, formatJobPostedDate } from './portal';

describe('job portal formatting', () => {
  it('combines remote and local location context', () => {
    expect(
      formatJobLocation({ isRemote: true, locationText: 'Lagos', campusName: null })
    ).toBe('Remote · Lagos');
  });

  it('falls back when a local role has no location', () => {
    expect(
      formatJobLocation({ isRemote: false, locationText: null, campusName: null })
    ).toBe('Location not specified');
  });

  it('formats recent posting dates for quick scanning', () => {
    const now = new Date('2026-07-25T12:00:00.000Z');
    expect(formatJobPostedDate('2026-07-25T08:00:00.000Z', now)).toBe('Posted today');
    expect(formatJobPostedDate('2026-07-22T08:00:00.000Z', now)).toBe('Posted 3 days ago');
  });
});
