/**
 * Referral code capture (Phase 4 · Q).
 *
 * Captured at APP BOOT, not at signup submit. The code has to survive a journey
 * that usually is not "land on /signup?ref=X and immediately register":
 *
 *   - an ambassador's link often lands on `/`, `/welcome` or (once R ships) a
 *     campus page, and the visitor clicks through to signup afterwards — by
 *     which point the query string is long gone;
 *   - the login↔signup toggle preserves `location.search`, but nothing else in
 *     the app promises to;
 *   - the confirmation email bounces the browser through GoTrue and back.
 *
 * Reading it only inside the signup handler meant any of those dropped the
 * attribution silently. Capturing on boot and stashing it makes the code
 * durable for the whole session.
 *
 * sessionStorage, not localStorage: an attribution should not outlive the visit
 * and quietly attach itself to an unrelated signup on the same machine weeks
 * later.
 */
export const REFERRAL_STORAGE_KEY = 'lantern_referral_code';

/** Conservative: this string ends up in signup metadata, so keep it boring. */
const CODE_RE = /^[A-Z0-9]{4,16}$/;

function normalize(raw: string | null | undefined): string | null {
  const candidate = (raw || '').trim().toUpperCase();
  return CODE_RE.test(candidate) ? candidate : null;
}

/**
 * Call once, as early as possible in app boot. Reads `?ref=` from whatever URL
 * the visitor landed on and stashes it. Safe to call repeatedly; a URL without
 * `?ref=` never clears an already-captured code.
 */
export function captureReferralCode(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    const fromUrl = normalize(new URLSearchParams(window.location.search).get('ref'));
    if (fromUrl) {
      window.sessionStorage.setItem(REFERRAL_STORAGE_KEY, fromUrl);
      return fromUrl;
    }
    return normalize(window.sessionStorage.getItem(REFERRAL_STORAGE_KEY));
  } catch {
    // Private-mode storage failures must never break boot.
    return null;
  }
}

/** The code to attach to signup metadata, if any. */
export function readReferralCode(): string | null {
  return captureReferralCode();
}

/** Called after a successful signup so the code cannot attach to a second one. */
export function clearReferralCode(): void {
  try {
    window.sessionStorage.removeItem(REFERRAL_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
