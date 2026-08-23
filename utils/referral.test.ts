/**
 * @vitest-environment jsdom
 *
 * Referral capture (Phase 4 · Q).
 *
 * Every referral in the product depends on this one function running early and
 * stashing durably — if it silently returns null, the whole workstream pays out
 * nothing and there is no error anywhere to explain why.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { captureReferralCode, clearReferralCode, readReferralCode, REFERRAL_STORAGE_KEY } from './referral';

function setUrl(search: string): void {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, search },
    writable: true,
    configurable: true,
  });
}

describe('captureReferralCode', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    setUrl('');
  });

  it('captures ?ref= and stashes it', () => {
    setUrl('?ref=3HYKM7Q');
    expect(captureReferralCode()).toBe('3HYKM7Q');
    expect(window.sessionStorage.getItem(REFERRAL_STORAGE_KEY)).toBe('3HYKM7Q');
  });

  it('uppercases, so a hand-typed lowercase link still attributes', () => {
    setUrl('?ref=3hykm7q');
    expect(captureReferralCode()).toBe('3HYKM7Q');
  });

  it('survives a later URL with no ?ref= — the whole point of stashing', () => {
    setUrl('?ref=3HYKM7Q');
    captureReferralCode();
    // The visitor clicks through from a campus page to /signup; query is gone.
    setUrl('');
    expect(readReferralCode()).toBe('3HYKM7Q');
  });

  it('does not let a bare URL clear an already-captured code', () => {
    setUrl('?ref=ABCD1234');
    captureReferralCode();
    setUrl('?utm_source=x');
    captureReferralCode();
    expect(window.sessionStorage.getItem(REFERRAL_STORAGE_KEY)).toBe('ABCD1234');
  });

  it('rejects junk rather than sending it to signup metadata', () => {
    for (const bad of ['ab', '../../etc', '<script>', 'A'.repeat(40), 'code with spaces']) {
      window.sessionStorage.clear();
      setUrl(`?ref=${encodeURIComponent(bad)}`);
      expect(captureReferralCode()).toBeNull();
      expect(window.sessionStorage.getItem(REFERRAL_STORAGE_KEY)).toBeNull();
    }
  });

  it('returns null with no code anywhere', () => {
    expect(captureReferralCode()).toBeNull();
  });

  it('clears after signup so it cannot attach to a second account', () => {
    setUrl('?ref=3HYKM7Q');
    captureReferralCode();
    clearReferralCode();
    setUrl('');
    expect(readReferralCode()).toBeNull();
  });
});
