import { describe, expect, it } from 'vitest';
import { parseCommunityCode, parseJoinTarget } from './joinByCode';

describe('parseCommunityCode', () => {
  it('reads the slug out of the link the invite button copies', () => {
    expect(parseCommunityCode('https://lanternstudy.com/discover/c/unilag-pharmacy')).toBe(
      'unilag-pharmacy'
    );
  });

  it('survives a paste with a tracking query and a trailing slash', () => {
    expect(parseCommunityCode('https://lanternstudy.com/discover/c/chess-club/?utm_source=wa')).toBe(
      'chess-club'
    );
  });

  it('ignores a fragment', () => {
    expect(parseCommunityCode('/discover/c/rag-week#members')).toBe('rag-week');
  });

  it('lands on the community when the link points deeper at a board', () => {
    expect(parseCommunityCode('/discover/c/rag-week/ch/6f6b/p/12')).toBe('rag-week');
  });

  it('accepts the forward /discover/join/<code> shape', () => {
    expect(parseCommunityCode('https://lanternstudy.com/discover/join/hostel-b')).toBe('hostel-b');
  });

  it('accepts a bare code typed by hand, case-insensitively', () => {
    expect(parseCommunityCode('  Hostel-B  ')).toBe('hostel-b');
  });

  it('decodes a percent-encoded segment', () => {
    expect(parseCommunityCode('/discover/c/rag%2Dweek')).toBe('rag-week');
  });

  it('answers null for things that are not codes', () => {
    expect(parseCommunityCode('')).toBeNull();
    expect(parseCommunityCode(null)).toBeNull();
    expect(parseCommunityCode('   ')).toBeNull();
    expect(parseCommunityCode('a')).toBeNull();
    expect(parseCommunityCode('not a code!')).toBeNull();
    expect(parseCommunityCode('https://example.com/')).toBeNull();
  });

  it('does not throw on a malformed percent escape', () => {
    expect(() => parseCommunityCode('/discover/c/100%')).not.toThrow();
  });
});

describe('parseJoinTarget', () => {
  it('reads a real invite code out of the link the invite panel copies', () => {
    expect(parseJoinTarget('https://lanternstudy.com/join/ABCD2345')).toEqual({
      kind: 'code',
      code: 'ABCD2345',
    });
  });

  it('normalises a code typed by hand — case, spaces and dashes', () => {
    expect(parseJoinTarget('  abcd-2345 ')).toEqual({ kind: 'code', code: 'ABCD2345' });
  });

  it('reads a public share link as a slug, not a code', () => {
    expect(parseJoinTarget('https://lanternstudy.com/discover/c/chess-club')).toEqual({
      kind: 'slug',
      slug: 'chess-club',
    });
  });

  it('falls back to a slug for a stale /join/ link from before codes existed', () => {
    expect(parseJoinTarget('/discover/join/hostel-b')).toEqual({ kind: 'slug', slug: 'hostel-b' });
  });

  it('answers unknown rather than guessing', () => {
    expect(parseJoinTarget('not a code!')).toEqual({ kind: 'unknown' });
    expect(parseJoinTarget('')).toEqual({ kind: 'unknown' });
    expect(parseJoinTarget(null)).toEqual({ kind: 'unknown' });
  });

  it('never reads a code as a slug — the two resolve through different routes', () => {
    expect(parseCommunityCode('https://lanternstudy.com/join/ABCD2345')).toBeNull();
  });
});
