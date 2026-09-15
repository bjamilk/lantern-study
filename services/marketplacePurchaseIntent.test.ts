/**
 * Fix F3 (web): an idempotency key belongs to the user's purchase INTENT, not
 * to the HTTP call.
 *
 * What used to happen: the web sent NO `Idempotency-Key` on buy-now, cart
 * checkout, offers or boosts, so deduping fell entirely to the server's
 * fallback key — a content hash bucketed into 5-minute windows. A buyer who
 * retried after a timeout that crossed a bucket boundary bought the thing
 * twice.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PURCHASE_INTENT_CONFLICT_RETRIES,
  purchaseIntentKey,
  resetPurchaseIntentsForTests,
  resolvePurchaseIntent,
  withPurchaseIntent,
} from './marketplacePurchaseIntent';

function httpError(status: number, message = 'nope'): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

describe('web purchase intent idempotency keys', () => {
  beforeEach(() => {
    resetPurchaseIntentsForTests();
    vi.useFakeTimers();
  });

  /** Advance the backoff timers while the retry loop awaits them. */
  async function flush(): Promise<void> {
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(5000);
    }
  }

  it('reuses one key across retries of the same intent', async () => {
    const seen: string[] = [];
    const run = async (key: string) => {
      seen.push(key);
      throw httpError(503, 'server blew up');
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(withPurchaseIntent('buy_now:l1:1:', run)).rejects.toThrow('server blew up');
    }
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(1);
  });

  it('keeps the key when the request fails with no status at all', async () => {
    const seen: string[] = [];
    const run = async (key: string) => {
      seen.push(key);
      throw new TypeError('Failed to fetch');
    };
    await expect(withPurchaseIntent('buy_now:l1:1:', run)).rejects.toThrow('Failed to fetch');
    await expect(withPurchaseIntent('buy_now:l1:1:', run)).rejects.toThrow('Failed to fetch');
    expect(seen[0]).toBe(seen[1]);
  });

  it('rotates the key once the purchase succeeds', async () => {
    const seen: string[] = [];
    const run = async (key: string) => {
      seen.push(key);
      return { ok: true };
    };
    await withPurchaseIntent('buy_now:l1:1:', run);
    await withPurchaseIntent('buy_now:l1:1:', run);
    expect(seen[0]).not.toBe(seen[1]);
  });

  it('rotates the key after a terminal 4xx the buyer has to fix', async () => {
    const seen: string[] = [];
    const run = async (key: string) => {
      seen.push(key);
      throw httpError(400, 'Coupon has expired');
    };
    await expect(withPurchaseIntent('buy_now:l1:1:', run)).rejects.toThrow('Coupon has expired');
    await expect(withPurchaseIntent('buy_now:l1:1:', run)).rejects.toThrow('Coupon has expired');
    expect(seen[0]).not.toBe(seen[1]);
  });

  it('retries a 409 with the SAME key rather than minting a new one', async () => {
    const seen: string[] = [];
    let calls = 0;
    const run = async (key: string) => {
      seen.push(key);
      calls++;
      if (calls === 1) throw httpError(409, 'Concurrent idempotent request timed out');
      return { orderId: 'o1' };
    };
    const promise = withPurchaseIntent('buy_now:l1:1:', run);
    await flush();
    await expect(promise).resolves.toEqual({ orderId: 'o1' });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  });

  it('gives up on a persistent 409 without ever changing the key', async () => {
    const seen: string[] = [];
    const run = async (key: string) => {
      seen.push(key);
      throw httpError(409, 'Concurrent idempotent request timed out');
    };
    // The assertion is attached BEFORE the timers run: flush() is what drives
    // the rejection, and an unobserved rejection fails the whole run.
    const assertion = expect(withPurchaseIntent('buy_now:l1:1:', run)).rejects.toThrow(
      'Concurrent idempotent request timed out'
    );
    await flush();
    await assertion;
    expect(seen).toHaveLength(PURCHASE_INTENT_CONFLICT_RETRIES + 1);
    expect(new Set(seen).size).toBe(1);
    // The intent is NOT resolved: the next attempt must still carry that key,
    // because the server may be finishing the first one.
    expect(purchaseIntentKey('buy_now:l1:1:')).toBe(seen[0]);
  });

  it('gives different intents different keys', () => {
    const keys = [
      purchaseIntentKey('buy_now:l1:1:'),
      purchaseIntentKey('buy_now:l1:2:'),
      purchaseIntentKey('cart_checkout::s1:campus_meetup'),
    ];
    expect(new Set(keys).size).toBe(3);
  });

  it('keeps every key inside the API 128-char header cap', () => {
    expect(purchaseIntentKey(`cart_checkout:${'x'.repeat(400)}`).length).toBeLessThanOrEqual(128);
  });

  it('mints a fresh key after the intent is explicitly resolved', () => {
    const first = purchaseIntentKey('boost:l1:72');
    resolvePurchaseIntent('boost:l1:72');
    expect(purchaseIntentKey('boost:l1:72')).not.toBe(first);
  });
});
