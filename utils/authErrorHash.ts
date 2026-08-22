/**
 * Supabase auth links (email confirmation, password reset, OAuth consent)
 * come back with `#error=...&error_code=...&error_description=...` when they
 * fail — expired, already used, or cancelled. The client used to drop that
 * hash silently: someone clicking "Reset password" from an old email just saw
 * the login screen with zero explanation. On this audience (emails opened
 * late over slow connections) that's a mainline path, not an edge case.
 */

const STORAGE_KEY = 'lantern_auth_link_error';

/** Parse + clear an auth error hash. Returns a user-facing message, or null. */
export function consumeAuthErrorHash(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash;
  if (!hash || !/error(_code|_description)?=/.test(hash)) return null;

  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const code = params.get('error_code') || '';
  const error = params.get('error') || '';
  if (!code && !error) return null;

  // Remove the hash so a refresh doesn't re-trigger, and so tokens/errors
  // never linger in the address bar.
  window.history.replaceState({}, '', window.location.pathname + window.location.search);

  if (code === 'otp_expired') {
    return 'That email link has expired or was already used. Request a fresh one below.';
  }
  if (error === 'access_denied') {
    return 'Sign-in was cancelled or the link is no longer valid. Try again.';
  }
  return 'That link could not be used. Try signing in, or request a new link.';
}

/** Stash the message for the auth screen to pick up after a redirect. */
export function stashAuthLinkError(message: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, message);
  } catch {
    /* ignore */
  }
}

/** Non-consuming check — used to decide routing without eating the message. */
export function peekStashedAuthLinkError(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/** One-shot read for the auth screen. */
export function takeStashedAuthLinkError(): string | null {
  try {
    const msg = sessionStorage.getItem(STORAGE_KEY);
    if (msg) sessionStorage.removeItem(STORAGE_KEY);
    return msg;
  } catch {
    return null;
  }
}
