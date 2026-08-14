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
