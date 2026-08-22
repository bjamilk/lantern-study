/**
 * ACCOUNT_SUSPENDED detection for the mobile API client (Phase 1 · E).
 *
 * The shared client (`packages/shared/src/api/client.ts`) collapses every
 * non-2xx body into `new Error(detail)` + `.status`, and for the suspension
 * 403 the body is `{ error: 'Forbidden', message: 'Account suspended until …',
 * code: 'ACCOUNT_SUSPENDED', suspendedUntil }` — so what reaches us is a bare
 * "Forbidden" with status 403, indistinguishable from any other 403. Rather
 * than patch global fetch, `api.ts` wraps request/requestRaw: on any 403 it
 * runs `probeAccountSuspension()`, one throttled raw fetch of
 * GET /users/me/moderation whose own 403 body carries the code + date (the
 * route is behind the same authMiddleware, so a suspended account gets the
 * same 403 there; a 200 proves the account is NOT suspended).
 */
import { useModerationStore } from '../stores/moderationStore';

export const ACCOUNT_SUSPENDED_CODE = 'ACCOUNT_SUSPENDED';

export interface SuspensionInfo {
  suspendedUntil: string | null;
  message: string | null;
}

/** Pure: read a 403 body; null unless it is the suspension shape. */
export function parseSuspensionBody(body: unknown): SuspensionInfo | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { code?: unknown; suspendedUntil?: unknown; message?: unknown; error?: unknown };
  if (b.code !== ACCOUNT_SUSPENDED_CODE) return null;
  const suspendedUntil = typeof b.suspendedUntil === 'string' && b.suspendedUntil ? b.suspendedUntil : null;
  const message =
    typeof b.message === 'string' && b.message
      ? b.message
      : typeof b.error === 'string' && b.error && b.error !== 'Forbidden'
        ? b.error
        : null;
  return { suspendedUntil, message };
}

/** Pure: true for errors the shared client raises from an HTTP 403. */
export function isForbiddenError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return (error as { status?: unknown }).status === 403;
}

/** Pure: "5 September 2026" for the banner; falls back to the raw string. */
export function formatSuspendedUntil(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

const PROBE_THROTTLE_MS = 15_000;
let lastProbeAt = 0;
let probeInFlight: Promise<void> | null = null;

interface ProbeDeps {
  getBaseUrl: () => string;
  getAuthHeaders: () => Promise<Record<string, string>>;
}

let deps: ProbeDeps | null = null;

/** Called once by services/api.ts so this module never imports supabase itself. */
export function configureSuspensionProbe(next: ProbeDeps): void {
  deps = next;
}

/**
 * Ask the API whether the caller is suspended. Throttled (one probe per 15 s,
 * shared between concurrent callers); never throws. `force` skips the throttle
 * for the banner's "Check again".
 */
export function probeAccountSuspension(options?: { force?: boolean }): Promise<void> {
  if (!deps) return Promise.resolve();
  const now = Date.now();
  if (probeInFlight) return probeInFlight;
  if (!options?.force && now - lastProbeAt < PROBE_THROTTLE_MS) return Promise.resolve();
  lastProbeAt = now;
  const { getBaseUrl, getAuthHeaders } = deps;
  probeInFlight = (async () => {
    try {
      const headers = await getAuthHeaders();
      if (!headers.Authorization) return;
      const response = await fetch(`${getBaseUrl()}/api/v1/users/me/moderation`, {
        method: 'GET',
        headers,
      });
      const store = useModerationStore.getState();
      if (response.status === 403) {
        const body = (await response.json().catch(() => null)) as unknown;
        const info = parseSuspensionBody(body);
        if (info) store.setSuspended(info);
        return;
      }
      if (response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { data?: { activeStrikes?: number; suspendedUntil?: string | null } }
          | null;
        if (store.suspendedUntil) store.clearSuspension();
        if (typeof body?.data?.activeStrikes === 'number') {
          store.setActiveStrikes(body.data.activeStrikes);
        }
      }
    } catch {
      // Offline / timeout: leave the flag as it was.
    } finally {
      probeInFlight = null;
    }
  })();
  return probeInFlight;
}

/** Test hook: reset the throttle between cases. */
export function __resetSuspensionProbeForTests(): void {
  lastProbeAt = 0;
  probeInFlight = null;
}
