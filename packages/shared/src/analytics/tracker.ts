import type { CookiePreferences } from '../cookieConsent';
import { isCookieCategoryAllowed } from '../cookieConsent';
import {
  ANALYTICS_ANON_ID_KEY,
  ANALYTICS_SESSION_ID_KEY,
  type ProductEventInput,
  type ProductEventPayload,
  type ProductEventSurface,
  isProductEventName,
  sanitizeEventProps,
} from './events';

export type ProductTrackerDeps = {
  getPreferences: () => CookiePreferences | null;
  getSurface: () => ProductEventSurface;
  getUserId?: () => string | null | undefined;
  /** Persist/load device anon id (only when analytics consent is on). */
  storage: {
    getItem: (key: string) => string | null | Promise<string | null>;
    setItem: (key: string, value: string) => void | Promise<void>;
    removeItem: (key: string) => void | Promise<void>;
  };
  transport: (events: ProductEventPayload[]) => Promise<void>;
  lowDataMode?: () => boolean;
  /** Max queue size before dropping oldest. */
  maxQueue?: number;
  flushAt?: number;
  flushIntervalMs?: number;
  now?: () => number;
  randomId?: () => string;
};

function defaultRandomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function readStorage(
  storage: ProductTrackerDeps['storage'],
  key: string
): Promise<string | null> {
  return storage.getItem(key);
}

async function writeStorage(
  storage: ProductTrackerDeps['storage'],
  key: string,
  value: string
): Promise<void> {
  await storage.setItem(key, value);
}

async function removeStorage(
  storage: ProductTrackerDeps['storage'],
  key: string
): Promise<void> {
  await storage.removeItem(key);
}

export type ProductTracker = {
  track: (input: ProductEventInput) => void;
  flush: () => Promise<void>;
  /** Call when cookie preferences change — drops queue and clears anon id on revoke. */
  onConsentChange: (prefs: CookiePreferences | null) => Promise<void>;
  isEnabled: () => boolean;
};

/**
 * Consent-gated first-party product analytics tracker.
 * No-ops unless analytics cookie category is allowed.
 */
export function createProductTracker(deps: ProductTrackerDeps): ProductTracker {
  const maxQueue = deps.maxQueue ?? 50;
  const flushAt = deps.flushAt ?? 10;
  const flushIntervalMs = deps.flushIntervalMs ?? 15_000;
  const randomId = deps.randomId ?? defaultRandomId;
  const now = deps.now ?? Date.now;

  let queue: ProductEventPayload[] = [];
  let flushing = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let sessionId: string | null = null;

  const isEnabled = () => isCookieCategoryAllowed(deps.getPreferences(), 'analytics');

  const ensureTimer = () => {
    if (timer != null) return;
    if (typeof setInterval === 'undefined') return;
    timer = setInterval(() => {
      void flush();
    }, flushIntervalMs);
    if (typeof timer === 'object' && timer && 'unref' in timer) {
      try {
        (timer as NodeJS.Timeout).unref();
      } catch {
        /* ignore */
      }
    }
  };

  const ensureSessionId = async (): Promise<string> => {
    if (sessionId) return sessionId;
    const existing = await readStorage(deps.storage, ANALYTICS_SESSION_ID_KEY);
    if (existing) {
      sessionId = existing;
      return existing;
    }
    const id = randomId();
    sessionId = id;
    await writeStorage(deps.storage, ANALYTICS_SESSION_ID_KEY, id);
    return id;
  };

  const ensureAnonId = async (): Promise<string | null> => {
    if (!isEnabled()) return null;
    const existing = await readStorage(deps.storage, ANALYTICS_ANON_ID_KEY);
    if (existing) return existing;
    const id = randomId();
    await writeStorage(deps.storage, ANALYTICS_ANON_ID_KEY, id);
    return id;
  };

  const flush = async (): Promise<void> => {
    if (flushing || queue.length === 0) return;
    if (!isEnabled()) {
      queue = [];
      return;
    }
    flushing = true;
    const batch = queue.splice(0, 25);
    try {
      await deps.transport(batch);
    } catch {
      // Re-queue failed batch (cap)
      queue = [...batch, ...queue].slice(0, maxQueue);
    } finally {
      flushing = false;
    }
  };

  const track = (input: ProductEventInput): void => {
    if (!isEnabled()) return;
    if (deps.lowDataMode?.()) return;
    if (!isProductEventName(input.event)) return;

    const props = sanitizeEventProps(input.props);
    const payload: ProductEventPayload = {
      event: input.event,
      surface: deps.getSurface(),
      props,
      campus: input.campus ? String(input.campus).slice(0, 120) : null,
      clientTs: new Date(now()).toISOString(),
    };

    // Resolve ids async then enqueue
    void (async () => {
      if (!isEnabled()) return;
      payload.sessionId = await ensureSessionId();
      payload.anonId = await ensureAnonId();
      queue.push(payload);
      if (queue.length > maxQueue) {
        queue = queue.slice(queue.length - maxQueue);
      }
      ensureTimer();
      if (queue.length >= flushAt) {
        await flush();
      }
    })();
  };

  const onConsentChange = async (prefs: CookiePreferences | null): Promise<void> => {
    if (!isCookieCategoryAllowed(prefs, 'analytics')) {
      queue = [];
      sessionId = null;
      await removeStorage(deps.storage, ANALYTICS_ANON_ID_KEY);
      await removeStorage(deps.storage, ANALYTICS_SESSION_ID_KEY);
    }
  };

  return { track, flush, onConsentChange, isEnabled };
}
