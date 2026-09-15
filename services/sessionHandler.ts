/**
 * Global session expiry handler for web client API calls, plus the ONE
 * auth-failure policy every `fetch` wrapper in the web app funnels through.
 *
 * Exports:
 *  - setSessionExpiredHandler / notifySessionExpired — the single sign-out
 *    reaction (App.tsx installs it: toast + apiLogoutSession + /welcome).
 *  - resetSessionExpiredGuard — re-arm after a successful login.
 *  - readAuthFailureCode / classifyAuthFailure — the shared classifier.
 *  - handleApiAuthFailure(statusOrResponse, { attempt }) — "should the caller
 *    retry this request?". Returns false unless a refresh actually succeeded
 *    AND the caller still has retry budget left.
 *
 * Policy (FIXED (F1), was E3 C4):
 *  - Every retry path has a budget of ONE retry. Callers pass `attempt`
 *    (0 for the first try); at `attempt >= MAX_AUTH_RETRY_ATTEMPTS` this
 *    returns false and the caller must surface the error instead of recursing.
 *  - A 403 is NEVER retried. It is a permission/suspension answer on a session
 *    that is still valid, so refreshing succeeds every time — that pair is what
 *    made a suspended account loop refresh → 403 → refresh forever.
 *  - Terminal codes (ACCOUNT_BANNED / SESSION_REVOKED / ACCOUNT_DEACTIVATED)
 *    never retry either: they sign the user out ONCE, with the reason in the
 *    message, via notifySessionExpired (whose `sessionExpiredNotified` latch is
 *    what makes it once-per-session).
 *  - ACCOUNT_SUSPENDED is deliberately NOT a sign-out: the product keeps a
 *    suspended student signed in so App.tsx can render the blocking notice
 *    (services/accountSuspension.ts). It is recorded there and never retried.
 */
let sessionExpiredHandler: ((message?: string) => void) | null = null;
let sessionExpiredNotified = false;
let refreshInFlight: Promise<SessionRefreshOutcome> | null = null;

/** One retry per request, after one refresh. Beyond this the caller must fail loudly. */
export const MAX_AUTH_RETRY_ATTEMPTS = 1;

/** Auth codes that mean "this session is over" — sign out once, never retry. */
export const TERMINAL_AUTH_CODES = [
  'ACCOUNT_BANNED',
  'SESSION_REVOKED',
  'ACCOUNT_DEACTIVATED',
] as const;
export type TerminalAuthCode = (typeof TERMINAL_AUTH_CODES)[number];

const TERMINAL_AUTH_MESSAGES: Record<TerminalAuthCode, string> = {
  ACCOUNT_BANNED: 'Your account has been banned. Contact support if you think this is a mistake.',
  SESSION_REVOKED: 'You were signed out because this session was revoked.',
  ACCOUNT_DEACTIVATED: 'This account is deactivated. Sign in again to reactivate it.',
};

export function isTerminalAuthCode(code: string | undefined): code is TerminalAuthCode {
  return !!code && (TERMINAL_AUTH_CODES as readonly string[]).includes(code);
}

/** Read `code` out of an error body without consuming the caller's response. */
export async function readAuthFailureCode(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.clone().json().catch(() => ({}))) as { code?: string };
    return typeof body?.code === 'string' ? body.code : undefined;
  } catch {
    return undefined;
  }
}

export type AuthFailureAction =
  /** Refreshable: the caller may retry once if a refresh succeeds. */
  | 'refresh'
  /** Over: sign the user out once with a reason. */
  | 'sign-out'
  /** Suspended: keep the session, show the blocking notice, never retry. */
  | 'suspended'
  /** Nothing to do — surface the error to the caller. */
  | 'give-up';

/** Decide what a 401/403 means, without acting on it. */
export function classifyAuthFailure(status: number, code: string | undefined): AuthFailureAction {
  if (status !== 401 && status !== 403) return 'give-up';
  if (isTerminalAuthCode(code)) return 'sign-out';
  if (code === 'ACCOUNT_SUSPENDED') return 'suspended';
  // A 403 on a valid session is a permission answer, not an expiry — refreshing
  // it can only loop.
  if (status === 403) return 'give-up';
  return 'refresh';
}

export function setSessionExpiredHandler(handler: (message?: string) => void): void {
  sessionExpiredHandler = handler;
}

/** Reset after a successful login so future 401s can recover again. */
export function resetSessionExpiredGuard(): void {
  sessionExpiredNotified = false;
  refreshInFlight = null;
}

export function notifySessionExpired(message = 'Your session has expired. Please sign in again.'): void {
  if (sessionExpiredNotified) return;
  sessionExpiredNotified = true;
  sessionExpiredHandler?.(message);
}

/** Sign out once, naming the reason the server gave. */
export function signOutForAuthCode(code: TerminalAuthCode): void {
  notifySessionExpired(TERMINAL_AUTH_MESSAGES[code]);
}

/**
 * What a refresh attempt actually proved.
 *
 * FIXED (SW) [Sentry WEB-17, 57 events / 5 users]: the old boolean collapsed
 * "your session is over" and "we could not ask right now" into one `false`, and
 * `handleApiAuthFailure` signed the user out for both. A Redis blip on the API
 * (the denylist fails closed, see apps/api-server/src/services/tokenDenylist.ts)
 * or a Render cold start therefore logged people out mid-session while their
 * HttpOnly cookie session was still perfectly valid. Only 'revoked' may ever
 * reach `notifySessionExpired`.
 */
export type SessionRefreshOutcome = 'refreshed' | 'revoked' | 'unavailable';

/** Mirror of `isCookieAuthEnabled()` that costs no import. See its use below. */
function cookieAuthModeOn(): boolean {
  if (typeof window === 'undefined') return false;
  const override = import.meta.env?.VITE_AUTH_COOKIE_MODE;
  if (override === 'true') return true;
  if (override === 'false') return false;
  return import.meta.env?.PROD === true;
}

/**
 * Refresh through the path that can actually succeed in this auth mode.
 *
 * FIXED (SW): in cookie mode the real refresh token lives only in the HttpOnly
 * cookie, so `supabase.auth.refreshSession()` is the WRONG primitive here — it
 * either posts the 'cookie-managed' placeholder (safe only because of the fetch
 * interceptor in services/supabase.ts) or, when supabase-js holds no memory
 * session at all, fails instantly with "Auth session missing" and never touches
 * the cookie. The BFF is asked directly instead, and `restoreCookieSession` —
 * whose `reason` already distinguishes revoked from network — is the tiebreaker
 * that decides whether this is a real sign-out.
 */
export async function refreshWebSessionOutcome(): Promise<SessionRefreshOutcome> {
  try {
    // The mode is read here rather than by importing `isCookieAuthEnabled`,
    // because pulling services/authCookieSession (and with it supabase-js) into
    // this module unconditionally is a heavy import on a path every 401 takes.
    // Same rule, same env var — keep the two in step if that default ever
    // changes (services/authCookieSession.ts::isCookieAuthEnabled).
    const cookieModule = cookieAuthModeOn() ? await import('./authCookieSession').catch(() => null) : null;
    if (cookieModule?.isCookieAuthEnabled()) {
      const refreshed = await cookieModule.refreshCookieSession().catch(() => null);
      if (refreshed?.access_token) {
        resetSessionExpiredGuard();
        return 'refreshed';
      }
      const restored = await cookieModule.restoreCookieSession();
      if (restored.ok) {
        resetSessionExpiredGuard();
        return 'refreshed';
      }
      // 'missing' is "there was never a session here" — not a revocation, and
      // signing out over it is exactly the spurious logout this lane fixes.
      return restored.reason === 'revoked' ? 'revoked' : 'unavailable';
    }

    const { supabase, setCachedAuthToken } = await import('./supabase');
    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data.session?.access_token) {
      setCachedAuthToken(data.session.access_token, data.session.user?.id);
      resetSessionExpiredGuard();
      return 'refreshed';
    }
    const status = (error as { status?: number } | null)?.status;
    const message = error?.message ?? '';
    if (status === 400 || status === 401 || /invalid|expired|refresh token/i.test(message)) {
      return 'revoked';
    }
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/** Back-compat boolean wrapper. Prefer `refreshWebSessionOutcome`. */
export async function refreshWebSession(): Promise<boolean> {
  return (await refreshWebSessionOutcome()) === 'refreshed';
}

/**
 * One shared refresh attempt that NEVER signs anyone out.
 *
 * FIXED (SW) [WEB-17]: the presence heartbeat used to run the full
 * `handleApiAuthFailure` policy, so a single 401 on a two-minute fire-and-forget
 * beat could end the session. A background beat may ask for a refresh; it may
 * not decide the session is over.
 */
export async function attemptSilentSessionRefresh(): Promise<boolean> {
  return (await sharedRefresh()) === 'refreshed';
}

/** The one in-flight refresh every caller shares. */
function sharedRefresh(): Promise<SessionRefreshOutcome> {
  if (!refreshInFlight) {
    refreshInFlight = refreshWebSessionOutcome().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/**
 * Returns true when the caller should retry the request after a refresh.
 *
 * Pass the Response when you have it — the classifier needs the `code` — and
 * the attempt number so the budget can be enforced. A bare status still works
 * for legacy callers, but then a terminal code cannot be seen and the answer is
 * simply "refresh once, or give up".
 */
export async function handleApiAuthFailure(
  statusOrResponse: number | Response,
  options: { attempt?: number } = {}
): Promise<boolean> {
  const isResponse = typeof statusOrResponse !== 'number';
  const status = isResponse ? statusOrResponse.status : statusOrResponse;
  if (status !== 401 && status !== 403) return false;

  const code = isResponse ? await readAuthFailureCode(statusOrResponse) : undefined;
  const action = classifyAuthFailure(status, code);

  if (action === 'sign-out') {
    signOutForAuthCode(code as TerminalAuthCode);
    return false;
  }
  if (action === 'suspended') {
    if (isResponse) {
      const { noteSuspendedResponse } = await import('./accountSuspension');
      await noteSuspendedResponse(statusOrResponse);
    }
    return false;
  }
  if (action === 'give-up') return false;

  // Budget: one retry per request. Without this a route that answers 401/403
  // on a session that refreshes cleanly recurses forever (E3 C4).
  // The retry itself already carried a fresh token, so a second 401 is not a
  // token problem — surface it to the caller instead of refreshing again.
  const attempt = options.attempt ?? 0;
  if (attempt >= MAX_AUTH_RETRY_ATTEMPTS) return false;

  if (sessionExpiredNotified) return false;

  const outcome = await sharedRefresh();
  if (outcome === 'refreshed') return true;
  // FIXED (SW) [WEB-17]: only a refresh the server actually REFUSED ends the
  // session. 'unavailable' (Redis blip answering 503, Render cold start, the
  // user's wifi) leaves them signed in and the caller simply surfaces the
  // failed request — the next call retries against the same live cookie.
  if (outcome === 'revoked') notifySessionExpired();
  return false;
}
