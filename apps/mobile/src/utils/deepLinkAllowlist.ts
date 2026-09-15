/**
 * What the app is willing to accept from an incoming URL, and what it must ask
 * the student before acting on it.
 *
 * Pure at module scope: no react, no react-native, no top-level expo import.
 * Every rule here is a function of the URL string plus who is signed in, so the
 * whole policy is testable in the node jest environment
 * (`deepLinkAllowlist.test.ts`) — which matters, because the callers
 * (`hooks/useDeepLinkHandler.ts`, the two auth screens) drag in native modules
 * that cannot be imported under ts-jest. The one runtime fact this file needs —
 * which URL scheme THIS build actually answers to — is read lazily, inside a
 * try/catch, and can be injected outright (`setRuntimeDeepLinkSchemes`).
 *
 * Main exports: `isAllowedMobileDeepLink`, `isAllowedMobileAuthUrl`,
 * `describeAuthLink`, `planAuthDeepLink`, `planInviteDeepLink`,
 * `inviteIdFromUrl`, `setRuntimeDeepLinkSchemes`.
 *
 * Threat model. A custom scheme is not a trust boundary: any installed app and
 * any web page can send `lanternstudy://…`, and Android hands it straight to
 * us. So a URL carrying auth tokens is an ATTACKER-CONTROLLED SESSION until the
 * student says otherwise — accepting one silently is session fixation (the
 * victim ends up typing a new password into the attacker's account). Two rules
 * follow, and both are enforced here rather than in the screens:
 *   1. parse only after the scheme/host allowlist passes;
 *   2. every session-establishing or membership-changing link needs an explicit
 *      in-app confirmation naming what is about to happen.
 */

const ALLOWED_DEEP_LINK_HOSTS = new Set(['lanternstudy.com', 'www.lanternstudy.com']);
const APP_SCHEME = 'lanternstudy';

/**
 * Schemes whose URL shape is `exp://host:port/--/path` rather than
 * `scheme://path`, so the host:port and the `--` separator have to come off
 * before the path can be read.
 */
const EXPO_TUNNEL_SCHEMES = new Set(['exp', 'exps']);

/**
 * WHICH SCHEMES THIS BUILD ANSWERS TO — derived, not guessed.
 *
 * This used to be gated on `__DEV__`, which is wrong in both directions: a
 * RELEASE build of the dev client (`com.lanternstudy.app.dev`) has
 * `__DEV__ === false` and so could not open a password-reset or invite link at
 * all (M5), while any debug build accepted every `com.lanternstudy.app*` scheme
 * whether or not it was its own.
 *
 * The truth is the app's own linking configuration: `Linking.createURL('/')` is
 * literally the first `prefixes` entry in navigation/linking.ts, and it resolves
 * to `exp://10.0.2.2:8081/--/` under Expo Go, to `com.lanternstudy.app.dev://`
 * in a dev client, and to `lanternstudy://` in a release build. Each build
 * therefore accepts exactly its own scheme and still rejects every other one —
 * including a neighbouring variant's.
 *
 * The lookup is lazy and defensive: expo is not importable under ts-jest, and a
 * failure here must degrade to "the production scheme only", never throw into a
 * link handler.
 */
let runtimeSchemes: Set<string> | null = null;

function schemeFromUrlish(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(value.trim());
  return match ? match[1].toLowerCase() : null;
}

function collectRuntimeSchemes(): Set<string> {
  const schemes = new Set<string>([APP_SCHEME]);
  const add = (value: unknown) => {
    const scheme = schemeFromUrlish(value) ?? (typeof value === 'string' ? value.trim().toLowerCase() : null);
    if (scheme && /^[a-z][a-z0-9+.-]*$/.test(scheme)) schemes.add(scheme);
  };

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const linking = require('expo-linking') as { createURL?: (path: string) => string };
    add(linking?.createURL?.('/'));
  } catch {
    // Not available (node tests, or a bundle without expo-linking): fall through.
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const constants = (require('expo-constants') as { default?: unknown }).default as
      | { expoConfig?: { scheme?: string | string[] } }
      | undefined;
    const configured = constants?.expoConfig?.scheme;
    if (Array.isArray(configured)) configured.forEach(add);
    else add(configured);
  } catch {
    // Same.
  }

  return schemes;
}

function acceptedSchemes(): Set<string> {
  if (!runtimeSchemes) runtimeSchemes = collectRuntimeSchemes();
  return runtimeSchemes;
}

/**
 * Inject the schemes this build answers to, for a host that already knows them
 * (and for tests). Always includes the production scheme; passing an empty list
 * narrows the allowlist to that alone.
 */
export function setRuntimeDeepLinkSchemes(schemes: readonly string[] | null): void {
  if (schemes === null) {
    runtimeSchemes = null;
    return;
  }
  const next = new Set<string>([APP_SCHEME]);
  for (const scheme of schemes) {
    const normalized = (schemeFromUrlish(scheme) ?? scheme.trim().toLowerCase());
    if (normalized && /^[a-z][a-z0-9+.-]*$/.test(normalized)) next.add(normalized);
  }
  runtimeSchemes = next;
}

/** `scheme` of `scheme://rest`, lowercased; null when the URL carries none. */
function schemeOf(url: string): string | null {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(url.trim());
  return match ? match[1].toLowerCase() : null;
}

/**
 * The app's own links (`lanternstudy://verify-email#access_token=…`) as a URL
 * object, so path/query/fragment can be read with the same code as an https
 * link. The custom scheme has no meaningful authority — `lanternstudy://x` is
 * the app's path `x`, not the host `x` — so it is folded onto the app's own
 * origin.
 *
 * Returns null for anything not on the allowlist. NOTHING may be parsed out of
 * a URL this rejects.
 */
function normalizedUrl(url: string): URL | null {
  if (!url || typeof url !== 'string') return null;
  const scheme = schemeOf(url);
  if (!scheme) return null;

  try {
    if (scheme === APP_SCHEME) {
      // `lanternstudy://p`, `lanternstudy:/p` and `lanternstudy:p` all mean path p.
      const rest = url.trim().replace(/^lanternstudy:\/*/i, '');
      return new URL(`https://lanternstudy.com/${rest}`);
    }

    if (scheme === 'https' || scheme === 'http') {
      const parsed = new URL(url.trim());
      return ALLOWED_DEEP_LINK_HOSTS.has(parsed.hostname.toLowerCase()) ? parsed : null;
    }

    // Any other scheme is accepted only when it is one THIS build was
    // configured with — never because the build happens to be a debug one.
    if (!acceptedSchemes().has(scheme)) return null;

    if (EXPO_TUNNEL_SCHEMES.has(scheme)) {
      // exp://host:port/--/path → path
      const rest = url.trim().replace(/^exps?:\/\/[^/]*\/?/i, '').replace(/^--\/?/, '');
      return new URL(`https://lanternstudy.com/${rest}`);
    }

    const rest = url.trim().replace(/^[^:]+:\/*/, '').replace(/^--\/?/, '');
    return new URL(`https://lanternstudy.com/${rest}`);
  } catch {
    return null;
  }
}

/**
 * Is this a URL the app is allowed to act on at all?
 *
 * It used to answer `true` for ANY string beginning `lanternstudy:` without
 * parsing it, and to answer `true` for every other scheme as well — an unknown
 * scheme was concatenated onto `https://lanternstudy.com/`, so the host check
 * it then ran was a check of our own hardcoded host. Both bypasses are closed:
 * a URL is allowed when it is the app's own scheme, or an https URL on an
 * allowlisted host, or a scheme THIS build was configured with (see
 * `acceptedSchemes`).
 */
export function isAllowedMobileDeepLink(url: string): boolean {
  return normalizedUrl(url) !== null;
}

// ─── Auth links ─────────────────────────────────────────────────────────────

/** How a link proposes to establish a session. */
export type AuthLinkKind = 'tokens' | 'code';

export interface AuthLinkInfo {
  /** Passed the scheme/host allowlist. */
  allowed: boolean;
  /** Null when the link is not an auth link at all. */
  kind: AuthLinkKind | null;
  /** The account the link signs into, when the link says (implicit grant only). */
  email: string | null;
  /** gotrue's own `error_code`, which must be shown rather than swallowed. */
  errorCode: string | null;
}

/**
 * gotrue puts the implicit grant in the FRAGMENT (`#access_token=…`) and the
 * PKCE grant in the query (`?code=…`), and errors can arrive in either.
 */
function paramsOf(parsed: URL): URLSearchParams {
  const hash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
  const merged = new URLSearchParams(parsed.search);
  if (hash) {
    new URLSearchParams(hash).forEach((value, key) => {
      if (!merged.has(key)) merged.append(key, value);
    });
  }
  return merged;
}

/** Base64url → string. Decode only; no verification is claimed or implied. */
function decodeBase64Url(input: string): string | null {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
  let bits = 0;
  let acc = 0;
  let out = '';
  for (const char of normalized) {
    const value = alphabet.indexOf(char);
    if (value < 0) return null;
    acc = (acc << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((acc >> bits) & 0xff);
    }
  }
  try {
    // The payload is UTF-8; `out` is its bytes as latin-1.
    return decodeURIComponent(
      out.replace(/[\s\S]/g, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
    );
  } catch {
    return out;
  }
}

/**
 * The email an access token claims, for the confirmation prompt ONLY.
 *
 * This is an UNVERIFIED read of an unverified token: the signature is not
 * checked here and cannot be. It exists so the student is asked "Sign in as
 * ada@unilag.edu.ng?" instead of "Sign in?" — a lie in this field costs the
 * attacker the very thing the prompt is for, since the name shown would then
 * be one the student does not recognise.
 */
export function emailFromAccessToken(token: string): string | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  const json = decodeBase64Url(parts[1]);
  if (!json) return null;
  try {
    const claims = JSON.parse(json) as { email?: unknown };
    return typeof claims.email === 'string' && claims.email.includes('@') ? claims.email : null;
  } catch {
    return null;
  }
}

/**
 * Classify an incoming URL as an auth link, without touching the session.
 *
 * A link only counts as an auth link when it arrives on one of the two paths
 * that exist for it. The previous rule accepted `access_token` or `code` on ANY
 * path, which made every deep link in the app a potential session-setter.
 */
export function describeAuthLink(url: string): AuthLinkInfo {
  const parsed = normalizedUrl(url);
  if (!parsed) return { allowed: false, kind: null, email: null, errorCode: null };

  const path = parsed.pathname.toLowerCase();
  const onAuthPath = path.includes('reset-password') || path.includes('verify-email');
  if (!onAuthPath) return { allowed: true, kind: null, email: null, errorCode: null };

  const params = paramsOf(parsed);
  const errorCode = params.get('error_code') ?? params.get('error') ?? null;
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');

  if (accessToken && refreshToken) {
    return {
      allowed: true,
      kind: 'tokens',
      email: emailFromAccessToken(accessToken),
      errorCode,
    };
  }
  if (params.get('code')) {
    // PKCE never carries the account, so the prompt cannot name it.
    return { allowed: true, kind: 'code', email: null, errorCode };
  }
  return { allowed: true, kind: null, email: null, errorCode };
}

/**
 * Kept for the two auth screens' guard clause. Now narrower than it was: a
 * random deep link with an `access_token` glued on is no longer an "auth URL".
 */
export function isAllowedMobileAuthUrl(url: string): boolean {
  const info = describeAuthLink(url);
  return info.allowed && (info.kind !== null || info.errorCode !== null);
}

/** What the app should do with an auth link, given who is signed in. */
export type AuthLinkDecision =
  | { action: 'ignore'; reason: 'not-allowed' | 'not-an-auth-link' }
  | { action: 'show-error'; errorCode: string }
  /** Nobody is signed in: ask "Sign in as <email>?" and only then set the session. */
  | { action: 'confirm-sign-in'; kind: AuthLinkKind; email: string | null }
  /** The link is for the account already signed in here; nothing to do. */
  | { action: 'already-signed-in'; email: string | null }
  /** Someone else is signed in: offer sign-out first, never switch silently. */
  | { action: 'confirm-sign-out-first'; kind: AuthLinkKind; email: string | null; currentEmail: string | null };

export interface SignedInIdentity {
  userId?: string | null;
  email?: string | null;
}

/**
 * The whole auth-deep-link policy in one place.
 *
 * `confirm-*` never means "done": the caller must get a real yes from the
 * student before `establishSessionFromAuthUrl` runs. The point of returning a
 * decision rather than doing the work is that this stays pure and provable.
 */
export function planAuthDeepLink(url: string, current: SignedInIdentity = {}): AuthLinkDecision {
  const info = describeAuthLink(url);
  if (!info.allowed) return { action: 'ignore', reason: 'not-allowed' };
  if (info.errorCode && !info.kind) return { action: 'show-error', errorCode: info.errorCode };
  if (!info.kind) return { action: 'ignore', reason: 'not-an-auth-link' };

  const currentEmail = current.email?.trim().toLowerCase() || null;
  const linkEmail = info.email?.trim().toLowerCase() || null;

  if (!current.userId) {
    return { action: 'confirm-sign-in', kind: info.kind, email: info.email };
  }
  if (linkEmail && currentEmail && linkEmail === currentEmail) {
    return { action: 'already-signed-in', email: info.email };
  }
  return {
    action: 'confirm-sign-out-first',
    kind: info.kind,
    email: info.email,
    currentEmail: current.email ?? null,
  };
}

// ─── Group invites ──────────────────────────────────────────────────────────

/**
 * The `?inviteId=` form (older links). The `/invite/<token>` path form is
 * resolved by `parseDeepLink` in the shared package; the caller merges the two.
 */
export function inviteIdFromUrl(url: string): string | null {
  const parsed = normalizedUrl(url);
  if (!parsed) return null;
  const id = parsed.searchParams.get('inviteId');
  return id && id.trim().length > 0 ? id.trim() : null;
}

export type InviteLinkDecision =
  | { action: 'ignore'; reason: 'not-allowed' | 'no-invite' | 'signed-out' }
  /** Ask "Join this group?" — joining is a membership change other people see. */
  | { action: 'confirm-join'; inviteId: string };

/**
 * Joining used to happen with no confirmation at all: any web page could fire
 * `lanternstudy://?inviteId=…` and silently add the signed-in student to an
 * attacker's group, exposing their name, avatar and academic profile to it.
 */
export function planInviteDeepLink(
  url: string,
  inviteId: string | null,
  userId?: string | null
): InviteLinkDecision {
  if (!isAllowedMobileDeepLink(url)) return { action: 'ignore', reason: 'not-allowed' };
  const id = inviteId?.trim() || inviteIdFromUrl(url);
  if (!id) return { action: 'ignore', reason: 'no-invite' };
  if (!userId) return { action: 'ignore', reason: 'signed-out' };
  return { action: 'confirm-join', inviteId: id };
}
