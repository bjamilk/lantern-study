const DEFAULT_UNCERTAIN_INTENT_TTL_MS = 5 * 60 * 1000;

type DeliveryIdentity = {
  id: string;
};

type UncertainDeliveryIntent = {
  operationId: string;
  expiresAt: number;
};

function intentKey(scope: string, fingerprint: string): string {
  return `${scope}\u0000${fingerprint}`;
}

/**
 * Remembers only sends whose outcome is uncertain. A manual retry can then use
 * the original operation id and safely replay against the server's unique key.
 */
export class DeliveryIntentRegistry {
  private readonly uncertain = new Map<string, UncertainDeliveryIntent>();

  constructor(private readonly ttlMs = DEFAULT_UNCERTAIN_INTENT_TTL_MS) {}

  private prune(nowMs: number): void {
    for (const [key, intent] of this.uncertain) {
      if (intent.expiresAt <= nowMs) this.uncertain.delete(key);
    }
  }

  resolve(
    scope: string,
    fingerprint: string,
    createOperationId: () => string,
    nowMs = Date.now()
  ): string {
    this.prune(nowMs);
    const key = intentKey(scope, fingerprint);
    const existing = this.uncertain.get(key);
    if (existing && existing.expiresAt > nowMs) {
      return existing.operationId;
    }
    return createOperationId();
  }

  markUncertain(
    scope: string,
    fingerprint: string,
    operationId: string,
    nowMs = Date.now()
  ): void {
    this.prune(nowMs);
    this.uncertain.set(intentKey(scope, fingerprint), {
      operationId,
      expiresAt: nowMs + this.ttlMs,
    });
  }

  clear(scope: string, fingerprint: string, operationId?: string): void {
    const key = intentKey(scope, fingerprint);
    const existing = this.uncertain.get(key);
    if (!existing || (operationId && existing.operationId !== operationId)) return;
    this.uncertain.delete(key);
  }
}

export function isUncertainDeliveryError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    name?: string;
    message?: string;
    deliveryUncertain?: boolean;
  };
  if (candidate.deliveryUncertain) return true;
  if (candidate.name === 'AbortError' || candidate.name === 'TypeError') return true;

  const message = String(candidate.message || '').toLowerCase();
  return [
    'failed to fetch',
    'network request failed',
    'network error',
    'request timed out',
    'load failed',
  ].some((fragment) => message.includes(fragment));
}

/**
 * Retrying is safe only when the caller reuses the same server-side operation
 * id (for chat this is clientMessageId).
 */
export async function retryUncertainDelivery<T>(
  request: () => Promise<T>,
  attempts = 2
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
    try {
      return await request();
    } catch (error) {
      lastError = error;
      if (!isUncertainDeliveryError(error) || attempt + 1 >= attempts) throw error;
    }
  }
  throw lastError;
}

/**
 * Replaces all optimistic/realtime aliases with one confirmed item while
 * retaining its first observed position.
 */
export function reconcileDeliveredItem<T extends DeliveryIdentity>(
  items: readonly T[],
  confirmed: T,
  aliases: readonly string[] = []
): T[] {
  const matchingIds = new Set([confirmed.id, ...aliases]);
  const firstMatch = items.findIndex((item) => matchingIds.has(item.id));
  const remaining = items.filter((item) => !matchingIds.has(item.id));
  const insertionIndex = firstMatch < 0 ? remaining.length : Math.min(firstMatch, remaining.length);
  remaining.splice(insertionIndex, 0, confirmed);
  return remaining;
}
