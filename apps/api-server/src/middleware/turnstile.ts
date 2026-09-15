/**
 * Cloudflare Turnstile server-side verification.
 *
 * Exports `verifyTurnstileToken` (the siteverify call), `isTurnstileEnforced`,
 * and `turnstileConfigStatus` for the /health payload. Calls Cloudflare's
 * siteverify endpoint with `TURNSTILE_SECRET`; `TURNSTILE_HOSTNAMES` is the
 * allowlist a token must have been solved on. No database, no other service.
 *
 * Coverage and configuration, not the verification logic — the checks below are
 * correct and fail closed on every uncertainty.
 *
 * FIXED (F10), the configuration half: `validateProductionSecrets` now says so
 * at boot. A production start with Turnstile unset logs one WARN naming the two
 * variables and the fact that the contact form is unprotected; a HALF-configured
 * start (one variable set, the other not) logs a louder line, because that is a
 * deployment that believes it has bot protection and does not. It is a warning
 * rather than a fatal because Turnstile is genuinely optional here — making it
 * required would turn a missing nice-to-have into a failed deploy.
 *
 * KNOWN ISSUE (tracked, deferred F10: product decision — challenging login,
 * signup and password reset means shipping the widget in the web and mobile
 * sign-in screens and accepting the drop-off that adds to the funnel, which is
 * the founder's call, not a middleware change): the only caller is
 * `routes/contact.ts`. No auth endpoint carries bot protection.
 */
import { logger } from '../utils/logger';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

interface SiteverifyResult {
  success: boolean;
  action?: string;
  hostname?: string;
  'error-codes'?: string[];
}

/** Hostnames the token is allowed to have been solved on, from the environment. */
function expectedHostnames(): Set<string> {
  return new Set(
    (process.env.TURNSTILE_HOSTNAMES ?? '')
      .split(',')
      .map((hostname) => hostname.trim())
      .filter(Boolean)
  );
}

/**
 * Turnstile is enforced only once both halves are configured. Until then the
 * protected route behaves exactly as it did before.
 *
 * This is deliberate rather than lax: the widget is env-gated on the client
 * too, so a half-configured deployment would otherwise reject every real
 * submission — an outage dressed up as security. Enforcement switches on when
 * TURNSTILE_SECRET and TURNSTILE_HOSTNAMES are both set.
 */
export function isTurnstileEnforced(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET) && expectedHostnames().size > 0;
}

/**
 * Which half of the configuration is missing, for /health.
 *
 * A single "off" could not distinguish "no secret" from "no hostnames", and
 * TURNSTILE_HOSTNAMES is the one people miss — it is not a secret, so it does
 * not feel like part of the credential. Reports presence only; no value of
 * either variable is exposed.
 */
export function turnstileConfigStatus():
  | 'enforced'
  | 'missing-secret'
  | 'missing-hostnames'
  | 'off' {
  const hasSecret = Boolean(process.env.TURNSTILE_SECRET);
  const hasHostnames = expectedHostnames().size > 0;
  if (hasSecret && hasHostnames) return 'enforced';
  if (hasSecret) return 'missing-hostnames';
  if (hasHostnames) return 'missing-secret';
  return 'off';
}

/**
 * Canonical server-side verification. Fails closed on every uncertainty:
 * network error, non-2xx, unparseable body, wrong action, unknown hostname.
 *
 * The action and hostname checks are what stop a token minted on some other
 * surface — or on an attacker's own page using this sitekey — from being
 * replayed here.
 */
export async function verifyTurnstileToken(params: {
  token: unknown;
  expectedAction: string;
  clientIp?: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const { token, expectedAction, clientIp } = params;

  // Fails OPEN when unconfigured — see the header. Everything past this line
  // fails closed.
  if (!isTurnstileEnforced()) return { ok: true };

  const hostnames = expectedHostnames();
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
    return { ok: false, reason: 'missing-token' };
  }

  let result: SiteverifyResult;
  try {
    const body = new URLSearchParams({
      secret: String(process.env.TURNSTILE_SECRET),
      response: token,
    });
    if (clientIp) body.set('remoteip', clientIp);

    const response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10_000),
      body,
    });
    if (!response.ok) throw new Error(`siteverify ${response.status}`);
    result = (await response.json()) as SiteverifyResult;
  } catch (err) {
    logger.warn('Turnstile siteverify call failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: 'verify-failed' };
  }

  if (!result.success) {
    return { ok: false, reason: (result['error-codes'] || []).join(',') || 'rejected' };
  }
  if (result.action !== expectedAction) {
    return { ok: false, reason: 'action-mismatch' };
  }
  if (!result.hostname || !hostnames.has(result.hostname)) {
    return { ok: false, reason: 'hostname-mismatch' };
  }
  return { ok: true };
}
