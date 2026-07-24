import { createHash, randomBytes } from 'crypto';

/** High-entropy share token (base64url, ~256 bits). */
export function generateNoteShareToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashNoteShareToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function isValidNoteShareTokenFormat(token: string): boolean {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(token);
}

export const NOTE_SHARE_WEB_PATH_PREFIX = '/notes/share/';

export function buildNoteShareWebUrl(token: string, baseUrl = 'https://lanternstudy.com'): string {
  return `${baseUrl.replace(/\/$/, '')}${NOTE_SHARE_WEB_PATH_PREFIX}${encodeURIComponent(token)}`;
}
