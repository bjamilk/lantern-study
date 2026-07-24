import {
  buildNoteShareWebUrl,
  generateNoteShareToken,
  hashNoteShareToken,
  isValidNoteShareTokenFormat,
} from './noteShareTokens';

describe('noteShareTokens', () => {
  it('generates high-entropy base64url tokens', () => {
    const a = generateNoteShareToken();
    const b = generateNoteShareToken();
    expect(a).not.toEqual(b);
    expect(isValidNoteShareTokenFormat(a)).toBe(true);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });

  it('hashes tokens stably with sha256 hex', () => {
    const token = 'abcdefghijklmnopqrstuvwxyz0123456789_-';
    const hash = hashNoteShareToken(token);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]+$/);
    expect(hashNoteShareToken(token)).toBe(hash);
    expect(hashNoteShareToken(`${token}x`)).not.toBe(hash);
  });

  it('rejects invalid token formats', () => {
    expect(isValidNoteShareTokenFormat('')).toBe(false);
    expect(isValidNoteShareTokenFormat('short')).toBe(false);
    expect(isValidNoteShareTokenFormat('has spaces and!!')).toBe(false);
  });

  it('builds canonical web share URLs', () => {
    const token = generateNoteShareToken();
    expect(buildNoteShareWebUrl(token)).toBe(
      `https://lanternstudy.com/notes/share/${encodeURIComponent(token)}`
    );
  });
});
